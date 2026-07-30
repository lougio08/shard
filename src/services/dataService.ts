import type { ShardWithKey, Shard } from "../types/types";
import type { PriceInfo, HistoryPoint } from "../types/types";
import { sortShardsByNameWithPrefixAwareness, filterShards, BASIC_FILTER_CONFIG, NAME_ONLY_FILTER_CONFIG } from "../utilities";

interface FusionData {
  shards: Record<string, Shard>;
  recipes: Record<string, Record<string, string[][]>>;
}

// Order book entry shape — compatible with both Hypixel and Coflnet APIs
interface OrderBookEntry {
  amount: number;
  pricePerUnit: number;
  orders: number;
}

// Price data source: SkyCoflnet API (https://sky.coflnet.com/api)
// Chosen over direct Hypixel API for richer data (order book snapshots, price history)
// and to provide a consistent single source of truth across all tabs.
// See: https://sky.coflnet.com/about, https://sky.coflnet.com/wiki/api

export class DataService {
  private static instance: DataService;
  private shardsCache: ShardWithKey[] | null = null;
  private shardNameToKeyCache: Record<string, string> | null = null;
  private defaultRatesCache: Record<string, number> | null = null;
  private fusionDataCache: FusionData | null = null;

  // Shared cache for all Coflnet bazaar fetches (prices + order books)
  private coflBazaarCache: {
    prices: Record<string, PriceInfo>;
    orderBooks: Record<string, { sellSummary: OrderBookEntry[]; buySummary: OrderBookEntry[] }>;
    timestamp: number;
  } | null = null;
  private readonly COFL_BAZAAR_CACHE_TTL = 120_000;

  public static getInstance(): DataService {
    if (!DataService.instance) {
      DataService.instance = new DataService();
    }
    return DataService.instance;
  }

  private async fetchJson<T>(filename: string): Promise<T> {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${filename}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      throw new Error(`Failed to load ${filename}: ${error}`);
    }
  }

  // ─── Coflnet batch fetch helper ───────────────────────────────────────────

  private async _fetchCoflBazaarSnapshots(
    internalIds: string[]
  ): Promise<Map<string, {
    buyPrice: number; sellPrice: number;
    buyVolume: number; sellVolume: number;
    buyMovingWeek: number; sellMovingWeek: number;
    buyOrders: OrderBookEntry[]; sellOrders: OrderBookEntry[];
  } | null>> {
    const results = new Map<string, {
      buyPrice: number; sellPrice: number;
      buyVolume: number; sellVolume: number;
      buyMovingWeek: number; sellMovingWeek: number;
      buyOrders: OrderBookEntry[]; sellOrders: OrderBookEntry[];
    } | null>();

    const BATCH_SIZE = 25;
    for (let i = 0; i < internalIds.length; i += BATCH_SIZE) {
      const batch = internalIds.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map(async (id) => {
          const resp = await fetch(`https://sky.coflnet.com/api/bazaar/${id}/snapshot`, {
            headers: { "User-Agent": "SkyShards/1.0 (+https://github.com/lougio08/shard)" },
          });
          if (resp.status === 429) {
            console.warn(`[SkyCofl] Rate limited on bazaar snapshot for ${id}`);
            return null;
          }
          if (!resp.ok) return null;
          return { id, data: await resp.json() };
        })
      );

      for (const result of settled) {
        if (result.status === "fulfilled" && result.value) {
          const { id, data } = result.value;
          results.set(id, {
            buyPrice: data.buyPrice ?? 0,
            sellPrice: data.sellPrice ?? 0,
            buyVolume: data.buyVolume ?? 0,
            sellVolume: data.sellVolume ?? 0,
            buyMovingWeek: data.buyMovingWeek ?? 0,
            sellMovingWeek: data.sellMovingWeek ?? 0,
            buyOrders: data.buyOrders ?? [],
            sellOrders: data.sellOrders ?? [],
          });
        } else if (result.status === "fulfilled") {
          // result.value is null (429 or error)
        }
      }

      if (i + BATCH_SIZE < internalIds.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    return results;
  }

  private _mapSnapshotsToPrices(
    shards: Shard[],
    snapshots: Map<string, {
      buyPrice: number; sellPrice: number;
      buyVolume: number; sellVolume: number;
      buyMovingWeek: number; sellMovingWeek: number;
    } | null>
  ): Record<string, PriceInfo> {
    const prices: Record<string, PriceInfo> = {};
    for (const shard of shards) {
      const snap = snapshots.get(shard.internal_id);
      if (snap) {
        prices[shard.id] = {
          // Coflnet: buyPrice = buy orders (bid, lower), sellPrice = sell orders (ask, higher)
          // buyCost (Buy Order) = buyPrice ; sellRevenue (Sell Order) = sellPrice
          buyCost: snap.buyPrice,
          sellRevenue: snap.sellPrice,
          buyVolume: snap.buyVolume,
          sellVolume: snap.sellVolume,
          dailyBuyVolume: snap.buyMovingWeek / 7,
          dailySellVolume: snap.sellMovingWeek / 7,
        };
      }
    }
    return prices;
  }

  private _mapSnapshotsToOrderBooks(
    shards: Shard[],
    snapshots: Map<string, {
      buyOrders: OrderBookEntry[]; sellOrders: OrderBookEntry[];
    } | null>
  ): Record<string, { sellSummary: OrderBookEntry[]; buySummary: OrderBookEntry[] }> {
    const orderBooks: Record<string, { sellSummary: OrderBookEntry[]; buySummary: OrderBookEntry[] }> = {};
    for (const shard of shards) {
      const snap = snapshots.get(shard.internal_id);
      if (snap) {
        orderBooks[shard.id] = {
          sellSummary: snap.sellOrders,
          buySummary: snap.buyOrders,
        };
      }
    }
    return orderBooks;
  }

  private _updateCoflCache(
    prices: Record<string, PriceInfo>,
    orderBooks: Record<string, { sellSummary: OrderBookEntry[]; buySummary: OrderBookEntry[] }> | null
  ) {
    this.coflBazaarCache = {
      prices,
      orderBooks: orderBooks ?? this.coflBazaarCache?.orderBooks ?? {},
      timestamp: Date.now(),
    };
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async loadShardCosts(useInstantBuyPrices: boolean): Promise<Record<string, number>> {
    if (this.coflBazaarCache && Date.now() - this.coflBazaarCache.timestamp < this.COFL_BAZAAR_CACHE_TTL) {
      return this._deriveCostsFromPrices(this.coflBazaarCache.prices, useInstantBuyPrices);
    }

    try {
      const shards = await this.loadShards();
      const internalIds = shards
        .map(s => s.internal_id)
        .filter(id => id && id.trim() !== "");
      const snapshots = await this._fetchCoflBazaarSnapshots(internalIds);
      const prices = this._mapSnapshotsToPrices(shards, snapshots);
      this._updateCoflCache(prices, null);
      return this._deriveCostsFromPrices(prices, useInstantBuyPrices);
    } catch {
      if (this.coflBazaarCache) {
        return this._deriveCostsFromPrices(this.coflBazaarCache.prices, useInstantBuyPrices);
      }
      return {};
    }
  }

  private _deriveCostsFromPrices(prices: Record<string, PriceInfo>, useInstantBuyPrices: boolean): Record<string, number> {
    const costs: Record<string, number> = {};
    for (const [id, info] of Object.entries(prices)) {
      costs[id] = useInstantBuyPrices ? info.sellRevenue : info.buyCost;
    }
    return costs;
  }

  async loadShards(): Promise<ShardWithKey[]> {
    if (this.shardsCache) {
      return this.shardsCache;
    }

    const [fusionData, defaultRates] = await Promise.all([this.fetchJson<FusionData>("fusion-data.json"), this.loadDefaultRates()]);

    this.shardsCache = Object.entries(fusionData.shards).map(([key, shard]: [string, Shard]) => ({
        key,
        ...shard,
        id: key,
        rate: defaultRates[key] || 0,
    }));

    return this.shardsCache;
  }

  async loadFusionData(): Promise<FusionData> {
    if (this.fusionDataCache) {
      return this.fusionDataCache;
    }

    this.fusionDataCache = await this.fetchJson<FusionData>("fusion-data.json");
    return this.fusionDataCache;
  }

  async getShardNameToKeyMap(): Promise<Record<string, string>> {
    if (this.shardNameToKeyCache) {
      return this.shardNameToKeyCache;
    }

    const shards = await this.loadShards();
    this.shardNameToKeyCache = shards.reduce((acc, shard) => {
      acc[shard.name.toLowerCase()] = shard.key;
      return acc;
    }, {} as Record<string, string>);

    return this.shardNameToKeyCache;
  }

  async loadDefaultRates(): Promise<Record<string, number>> {
    if (this.defaultRatesCache) {
      return this.defaultRatesCache;
    }

    this.defaultRatesCache = await this.fetchJson<Record<string, number>>("rates.json");
    return this.defaultRatesCache;
  }

  private sortShardsByQuery(shards: ShardWithKey[], query: string): ShardWithKey[] {
    const lowerQuery = query.toLowerCase();
    return shards.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aKey = a.key.toLowerCase();
      const bKey = b.key.toLowerCase();
      const aStarts = aName.startsWith(lowerQuery) || aKey.startsWith(lowerQuery);
      const bStarts = bName.startsWith(lowerQuery) || bKey.startsWith(lowerQuery);
      
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return sortShardsByNameWithPrefixAwareness(a, b);
    });
  }

  async searchShards(query: string): Promise<ShardWithKey[]> {
    const shards = await this.loadShards();
    const filtered = filterShards(shards, {
      query,
      searchConfig: BASIC_FILTER_CONFIG,
    });

    return this.sortShardsByQuery(filtered, query);
  }

  async searchShardsByNameOnly(query: string): Promise<ShardWithKey[]> {
    const shards = await this.loadShards();
    const filtered = filterShards(shards, {
      query,
      searchConfig: NAME_ONLY_FILTER_CONFIG,
    });

    // If no results found searching by name only, try searching title and description
    if (filtered.length === 0) {
      const fallbackConfig = {
        name: false,
        key: false,
        family: false,
        type: false,
        title: true,
        description: true,
      };

      const fallbackFiltered = filterShards(shards, {
        query,
        searchConfig: fallbackConfig,
      });

      return this.sortShardsByQuery(fallbackFiltered, query);
    }

    return this.sortShardsByQuery(filtered, query);
  }

  async fetchCoflBazaarInfosWithOrders(): Promise<{
    prices: Record<string, PriceInfo>;
    orderBooks: Record<string, { sellSummary: OrderBookEntry[]; buySummary: OrderBookEntry[] }>;
  }> {
    if (this.coflBazaarCache && Date.now() - this.coflBazaarCache.timestamp < this.COFL_BAZAAR_CACHE_TTL) {
      return { prices: this.coflBazaarCache.prices, orderBooks: this.coflBazaarCache.orderBooks };
    }

    try {
      const shards = await this.loadShards();
      const internalIds = shards
        .map(s => s.internal_id)
        .filter(id => id && id.trim() !== "");
      const snapshots = await this._fetchCoflBazaarSnapshots(internalIds);
      const prices = this._mapSnapshotsToPrices(shards, snapshots);
      const orderBooks = this._mapSnapshotsToOrderBooks(shards, snapshots);
      this._updateCoflCache(prices, orderBooks);
      return { prices, orderBooks };
    } catch {
      if (this.coflBazaarCache) {
        return { prices: this.coflBazaarCache.prices, orderBooks: this.coflBazaarCache.orderBooks };
      }
      return { prices: {}, orderBooks: {} };
    }
  }

  async fetchSkyCoflBazaarPrices(shards: Shard[]): Promise<Record<string, PriceInfo> | null> {
    if (this.coflBazaarCache && Date.now() - this.coflBazaarCache.timestamp < this.COFL_BAZAAR_CACHE_TTL) {
      return Object.keys(this.coflBazaarCache.prices).length > 0 ? this.coflBazaarCache.prices : null;
    }

    const internalIds = shards
      .map(s => s.internal_id)
      .filter(id => id && id.trim() !== "");
    const snapshots = await this._fetchCoflBazaarSnapshots(internalIds);
    const prices = this._mapSnapshotsToPrices(shards, snapshots);
    this._updateCoflCache(prices, null);
    return Object.keys(prices).length > 0 ? prices : null;
  }

  private historyCache = new Map<string, { data: HistoryPoint[]; fetchedAt: number }>();
  private readonly HISTORY_CACHE_TTL_MS = 12 * 60 * 1000;

  async fetchPriceHistory(internalId: string): Promise<HistoryPoint[] | null> {
    const cached = this.historyCache.get(internalId);
    if (cached && Date.now() - cached.fetchedAt < this.HISTORY_CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const resp = await fetch(`https://sky.coflnet.com/api/bazaar/${internalId}/history/day`, {
        headers: { "User-Agent": "SkyShards/1.0 (+https://github.com/lougio08/shard)" },
      });

      if (resp.status === 429) {
        console.warn(`[SkyCofl] Rate limited on history fetch for ${internalId}`);
        return null;
      }
      if (!resp.ok) return null;

      const data: HistoryPoint[] = await resp.json();
      this.historyCache.set(internalId, { data, fetchedAt: Date.now() });
      return data;
    } catch (err) {
      console.warn(`[SkyCofl] Failed to fetch history for ${internalId}:`, err);
      return null;
    }
  }

  async fetchPriceHistoriesForShards(internalIds: string[]): Promise<Map<string, HistoryPoint[] | null>> {
    const results = new Map<string, HistoryPoint[] | null>();

    const toFetch = internalIds.filter(id => {
      const cached = this.historyCache.get(id);
      return !cached || Date.now() - cached.fetchedAt >= this.HISTORY_CACHE_TTL_MS;
    });

    const BATCH_SIZE = 25;
    const uniqueIds = [...new Set(toFetch)];

    for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
      const batch = uniqueIds.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(id => this.fetchPriceHistory(id))
      );
      if (i + BATCH_SIZE < uniqueIds.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    for (const id of internalIds) {
      results.set(id, this.historyCache.get(id)?.data ?? null);
    }

    return results;
  }
}
