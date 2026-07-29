import type { ShardWithKey, Shard } from "../types/types";
import type { PriceInfo, HistoryPoint } from "../types/types";
import { sortShardsByNameWithPrefixAwareness, filterShards, BASIC_FILTER_CONFIG, NAME_ONLY_FILTER_CONFIG } from "../utilities";

interface FusionData {
  shards: Record<string, Shard>;
  recipes: Record<string, Record<string, string[][]>>;
}

interface BazaarCache {
  data: Record<string, number>;
  timestamp: number;
  useInstantBuyPrices: boolean;
}

interface HypixelOrderBookEntry {
  amount: number;
  pricePerUnit: number;
  orders: number;
}

interface HypixelProduct {
  quick_status: {
    buyPrice: number;
    sellPrice: number;
    buyVolume: number;
    sellVolume: number;
    buyMovingWeek: number;
    sellMovingWeek: number;
  };
  sell_summary?: HypixelOrderBookEntry[];
  buy_summary?: HypixelOrderBookEntry[];
}

export class DataService {
  private static instance: DataService;
  private shardsCache: ShardWithKey[] | null = null;
  private shardNameToKeyCache: Record<string, string> | null = null;
  private defaultRatesCache: Record<string, number> | null = null;
  private fusionDataCache: FusionData | null = null;
  private bazaarPriceCache: BazaarCache | null = null;
  private bazaarRawProductsCache: Record<string, HypixelProduct> | null = null;
  private bazaarRawTimestamp: number = 0;
  private readonly BAZAAR_CACHE_TTL = 120_000;

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

  private async fetchHypixelBazaarProducts(): Promise<Record<string, HypixelProduct>> {
    const now = Date.now();
    if (this.bazaarRawProductsCache && now - this.bazaarRawTimestamp < this.BAZAAR_CACHE_TTL) {
      return this.bazaarRawProductsCache;
    }
    const response = await fetch("https://api.hypixel.net/v2/skyblock/bazaar");
    if (!response.ok) {
      throw new Error(`Hypixel API error: ${response.status}`);
    }
    const json = await response.json();
    const products: Record<string, HypixelProduct> = json.products || {};
    this.bazaarRawProductsCache = products;
    this.bazaarRawTimestamp = now;
    return products;
  }

  async fetchBazaarPriceInfos(): Promise<Record<string, PriceInfo>> {
    try {
      const products = await this.fetchHypixelBazaarProducts();
      const shards = await this.loadShards();
      const infos: Record<string, PriceInfo> = {};
      for (const shard of shards) {
        const product = products[shard.internal_id];
        if (product?.quick_status) {
          const qs = product.quick_status;
          infos[shard.id] = {
            buyCost: qs.buyPrice,
            sellRevenue: qs.sellPrice,
            buyVolume: qs.buyVolume,
            sellVolume: qs.sellVolume,
            dailyBuyVolume: qs.buyMovingWeek / 7,
            dailySellVolume: qs.sellMovingWeek / 7,
          };
        }
      }
      return infos;
    } catch {
      return {};
    }
  }

  async loadShardCosts(useInstantBuyPrices: boolean): Promise<Record<string, number>> {
    const now = Date.now();
    if (this.bazaarPriceCache && now - this.bazaarPriceCache.timestamp < this.BAZAAR_CACHE_TTL && this.bazaarPriceCache.useInstantBuyPrices === useInstantBuyPrices) {
      return this.bazaarPriceCache.data;
    }

    try {
      const products = await this.fetchHypixelBazaarProducts();
      const shards = await this.loadShards();
      const costs: Record<string, number> = {};
      for (const shard of shards) {
        const product = products[shard.internal_id];
        if (product?.quick_status) {
          costs[shard.id] = useInstantBuyPrices ? product.quick_status.sellPrice : product.quick_status.buyPrice;
        }
      }

      this.bazaarPriceCache = { data: costs, timestamp: now, useInstantBuyPrices };
      return costs;
    } catch (error) {
      if (this.bazaarPriceCache && this.bazaarPriceCache.useInstantBuyPrices === useInstantBuyPrices) {
        return this.bazaarPriceCache.data;
      }
      return {};
    }
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

  async fetchBazaarInfosWithOrders(): Promise<{
    prices: Record<string, PriceInfo>;
    orderBooks: Record<string, { sellSummary: HypixelOrderBookEntry[]; buySummary: HypixelOrderBookEntry[] }>;
  }> {
    try {
      const products = await this.fetchHypixelBazaarProducts();
      const shards = await this.loadShards();
      const prices: Record<string, PriceInfo> = {};
      const orderBooks: Record<string, { sellSummary: HypixelOrderBookEntry[]; buySummary: HypixelOrderBookEntry[] }> = {};
      for (const shard of shards) {
        const product = products[shard.internal_id];
        if (product?.quick_status) {
          const qs = product.quick_status;
          prices[shard.id] = {
            buyCost: qs.buyPrice,
            sellRevenue: qs.sellPrice,
            buyVolume: qs.buyVolume,
            sellVolume: qs.sellVolume,
            dailyBuyVolume: qs.buyMovingWeek / 7,
            dailySellVolume: qs.sellMovingWeek / 7,
          };
          orderBooks[shard.id] = {
            sellSummary: product.sell_summary ?? [],
            buySummary: product.buy_summary ?? [],
          };
        }
      }
      return { prices, orderBooks };
    } catch {
      return { prices: {}, orderBooks: {} };
    }
  }

  async fetchSkyCoflBazaarPrices(shards: Shard[]): Promise<Record<string, PriceInfo> | null> {
    const prices: Record<string, PriceInfo> = {};
    const internalIds = shards
      .map(s => s.internal_id)
      .filter(id => id && id.trim() !== "");

    const BATCH_SIZE = 25;
    for (let i = 0; i < internalIds.length; i += BATCH_SIZE) {
      const batch = internalIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (id) => {
          const resp = await fetch(`https://sky.coflnet.com/api/bazaar/${id}/snapshot`, {
            headers: { "User-Agent": "SkyShards/1.0 (+https://github.com/lougio08/shard)" },
          });
          if (!resp.ok) return null;
          const data = await resp.json();
          return { id, data };
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          const { id, data } = result.value;
          const shard = shards.find(s => s.internal_id === id);
          if (shard) {
            prices[shard.id] = {
              buyCost: data.buyPrice ?? 0,
              sellRevenue: data.sellPrice ?? 0,
              buyVolume: data.buyVolume ?? 0,
              sellVolume: data.sellVolume ?? 0,
              dailyBuyVolume: (data.buyMovingWeek ?? 0) / 7,
              dailySellVolume: (data.sellMovingWeek ?? 0) / 7,
            };
          }
        }
      }

      if (i + BATCH_SIZE < internalIds.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

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
