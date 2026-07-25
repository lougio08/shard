import type { Data, CalculationParams, RecipeTree, PriceInfo, HistoryPoint, Shard } from "../types/types";
import type { FusionData } from "./recipeUtils";
import { STABLE_MIN_DAILY_BUY_VOLUME } from "./stableFilter";

const PRICE_SWING_THRESHOLD = 0.5;

export function getTreeBuyNodes(tree: RecipeTree): string[] {
  if (tree.method === "direct") return [tree.shard];
  if (tree.method === "recipe") {
    return [...getTreeBuyNodes(tree.inputs[0]), ...getTreeBuyNodes(tree.inputs[1])];
  }
  if (tree.method === "cycle") {
    return [...getTreeBuyNodes(tree.inputRecipe), ...tree.cycleInputs.flatMap(getTreeBuyNodes)];
  }
  return [];
}

export const DEFAULT_CALCULATION_PARAMS: CalculationParams = {
  customRates: {},
  hunterFortune: 0,
  excludeChameleon: false,
  frogBonus: false,
  newtLevel: 0,
  salamanderLevel: 0,
  lizardKingLevel: 0,
  leviathanLevel: 0,
  pythonLevel: 0,
  kingCobraLevel: 0,
  seaSerpentLevel: 0,
  tiamatLevel: 0,
  crocodileLevel: 0,
  kuudraTier: "none",
  moneyPerHour: null,
  customKuudraTime: false,
  kuudraTimeSeconds: null,
  noWoodenBait: false,
  rateAsCoinValue: false,
  craftPenalty: 0.8,
};

export function buildDataFromFusionData(
  fusionData: FusionData,
  defaultRates: Record<string, number>
): Data {
  const data: Data = { recipes: {}, shards: {} };

  for (const [outputShard, recipeEntries] of Object.entries(fusionData.recipes)) {
    data.recipes[outputShard] = [];
    for (const [qtyStr, recipeList] of Object.entries(recipeEntries)) {
      const qty = parseInt(qtyStr);
      for (const inputs of recipeList as string[][]) {
        const input1 = inputs[0];
        const input2 = inputs[1];
        if (!fusionData.shards[input1] || !fusionData.shards[input2]) continue;
        const isReptile =
          fusionData.shards[input1]?.family?.includes("Reptile") ||
          fusionData.shards[input2]?.family?.includes("Reptile") ||
          false;
        data.recipes[outputShard].push({
          inputs: [input1, input2],
          outputQuantity: qty,
          isReptile,
        });
      }
    }
  }

  for (const [shardId, shardEntry] of Object.entries(fusionData.shards)) {
    data.shards[shardId] = {
      ...shardEntry,
      id: shardId,
      rate: defaultRates[shardId] ?? 0,
      rarity: shardEntry.rarity as any,
    };
  }

  return data;
}

export function detectVolatileShards(
  currentPrices: Record<string, PriceInfo>,
  previousPrices: Record<string, { buyCost: number; sellRevenue: number }> | null
): Set<string> {
  const volatileShardIds = new Set<string>();
  if (!previousPrices) return volatileShardIds;

  for (const [shardId, current] of Object.entries(currentPrices)) {
    const prev = previousPrices[shardId];
    if (!prev) continue;
    const buyChange = Math.abs(current.buyCost - prev.buyCost) / prev.buyCost;
    const sellChange =
      Math.abs(current.sellRevenue - prev.sellRevenue) / prev.sellRevenue;
    if (buyChange >= PRICE_SWING_THRESHOLD || sellChange >= PRICE_SWING_THRESHOLD) {
      volatileShardIds.add(shardId);
    }
  }

  return volatileShardIds;
}

export function detectSuspiciousOrderBookPrices(
  orderBooks: Record<string, { sellSummary: { amount: number; pricePerUnit: number; orders: number }[]; buySummary: { amount: number; pricePerUnit: number; orders: number }[] }>
): Set<string> {
  const suspicious = new Set<string>();
  for (const [shardId, book] of Object.entries(orderBooks)) {
    if (book.sellSummary.length >= 2) {
      const best = book.sellSummary[0];
      const next = book.sellSummary[1];
      if (next.pricePerUnit / best.pricePerUnit > 3) {
        suspicious.add(shardId);
        continue;
      }
    }
    if (book.buySummary.length >= 2) {
      const best = book.buySummary[0];
      const next = book.buySummary[1];
      if (best.pricePerUnit / next.pricePerUnit > 3) {
        suspicious.add(shardId);
        continue;
      }
    }
    if (book.sellSummary.length > 0 && book.buySummary.length > 0) {
      const sellPrice = book.sellSummary[0].pricePerUnit;
      const buyPrice = book.buySummary[0].pricePerUnit;
      const mid = (sellPrice + buyPrice) / 2;
      if (mid > 0 && (sellPrice - buyPrice) / mid > 0.5) {
        suspicious.add(shardId);
      }
    }
  }
  return suspicious;
}

export { PRICE_SWING_THRESHOLD };

export const PRICE_ANOMALY_THRESHOLD = 0.30;

export interface PriceAnomalyResult {
  isAnomalous: boolean;
  currentPrice: number;
  averagePrice24h: number;
  dropPercent: number;
}

export function detectPriceAnomaly(
  currentPrice: number,
  history: HistoryPoint[] | null,
  field: "buy" | "sell"
): PriceAnomalyResult {
  if (!history || history.length === 0) {
    return { isAnomalous: false, currentPrice, averagePrice24h: currentPrice, dropPercent: 0 };
  }

  const values = history.map((p) => p[field]).filter((v) => v > 0);
  if (values.length === 0) {
    return { isAnomalous: false, currentPrice, averagePrice24h: currentPrice, dropPercent: 0 };
  }

  const average = values.reduce((a, b) => a + b, 0) / values.length;
  const dropPercent = average > 0 ? (average - currentPrice) / average : 0;

  return {
    isAnomalous: dropPercent > PRICE_ANOMALY_THRESHOLD,
    currentPrice,
    averagePrice24h: average,
    dropPercent,
  };
}

export function isStableVolume(dailyBuyVolume: number): boolean {
  return dailyBuyVolume >= STABLE_MIN_DAILY_BUY_VOLUME;
}

export function collectTreeShardIds(
  tree: RecipeTree,
  shards: Record<string, Shard>,
  visited = new Set<string>()
): string[] {
  if (visited.has(tree.shard)) return [];
  visited.add(tree.shard);

  const ids: string[] = [];
  const internalId = shards[tree.shard]?.internal_id;
  if (internalId) ids.push(internalId);

  if (tree.method === "recipe" && tree.inputs) {
    ids.push(...collectTreeShardIds(tree.inputs[0], shards, visited));
    ids.push(...collectTreeShardIds(tree.inputs[1], shards, visited));
  }
  if (tree.method === "cycle") {
    if (tree.inputRecipe) ids.push(...collectTreeShardIds(tree.inputRecipe, shards, visited));
    tree.cycleInputs.forEach((ci) => ids.push(...collectTreeShardIds(ci, shards, visited)));
  }

  return ids;
}
