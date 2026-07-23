import type { ShardWithKey, Shard } from "../types/types";
import type { SkyCoflBazaarSnapshot } from "../types/skyCoflApiTypes";
import { sortShardsByNameWithPrefixAwareness, filterShards, BASIC_FILTER_CONFIG, NAME_ONLY_FILTER_CONFIG } from "../utilities";

interface FusionData {
  shards: Record<string, Shard>;
  recipes: Record<string, Record<string, string[][]>>;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [500, 1000, 2000];

export class DataService {
  private static instance: DataService;
  private shardsCache: ShardWithKey[] | null = null;
  private shardNameToKeyCache: Record<string, string> | null = null;
  private defaultRatesCache: Record<string, number> | null = null;
  private fusionDataCache: FusionData | null = null;

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

  async fetchSkyCoflSnapshot(itemTag: string): Promise<SkyCoflBazaarSnapshot | null> {
    try {
      const response = await fetch(`https://sky.coflnet.com/api/bazaar/${itemTag}/snapshot`);
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  async fetchSkyCoflBazaarPrices(shards: ShardWithKey[]): Promise<Record<string, SkyCoflBazaarSnapshot>> {
    const SKYCOFL_BASE = "https://sky.coflnet.com/api/bazaar";
    const BATCH_SIZE = 25;
    const DELAY_MS = 1200;
    const results: Record<string, SkyCoflBazaarSnapshot> = {};

    for (let i = 0; i < shards.length; i += BATCH_SIZE) {
      const batch = shards.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (shard) => {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            const resp = await fetch(`${SKYCOFL_BASE}/${shard.internal_id}/snapshot`);
            if (!resp.ok) {
              if (attempt < MAX_RETRIES - 1) {
                await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
                continue;
              }
              return;
            }
            const data: SkyCoflBazaarSnapshot = await resp.json();
            results[shard.id] = data;
            return;
          } catch {
            if (attempt < MAX_RETRIES - 1) {
              await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
            }
          }
        }
      });
      await Promise.all(promises);
      if (i + BATCH_SIZE < shards.length) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }

    return results;
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

  async loadShardCosts(useInstantBuyPrices: boolean): Promise<Record<string, number>> {
    const shards = await this.loadShards();
    const skyCoflPrices = await this.fetchSkyCoflBazaarPrices(shards);
    const costs: Record<string, number> = {};

    for (const shard of shards) {
      const snapshot = skyCoflPrices[shard.id];
      if (snapshot) {
        costs[shard.id] = useInstantBuyPrices ? snapshot.buyPrice : snapshot.sellPrice;
      }
    }

    return costs;
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
}
