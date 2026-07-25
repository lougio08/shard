import type { Data, Shards, Recipes } from "../types/types";

export const STABLE_MIN_DAILY_BUY_VOLUME = 5000;

export function applyStableFilter(
  data: Data,
  excludedShardIds: Set<string>,
  keepShardId?: string
): Data {
  const filteredShards: Shards = {};
  for (const [id, shard] of Object.entries(data.shards)) {
    const isExcluded = excludedShardIds.has(id) && id !== keepShardId;
    filteredShards[id] = isExcluded ? { ...shard, rate: 0 } : shard;
  }

  const filteredRecipes: Recipes = {};
  for (const [output, recipeList] of Object.entries(data.recipes)) {
    filteredRecipes[output] = recipeList.filter((recipe) => {
      const [input1, input2] = recipe.inputs;
      const input1Excluded = excludedShardIds.has(input1) && input1 !== keepShardId;
      const input2Excluded = excludedShardIds.has(input2) && input2 !== keepShardId;
      return !input1Excluded && !input2Excluded;
    });
  }

  return { shards: filteredShards, recipes: filteredRecipes };
}

export function getUnstableShardIds(
  prices: Record<string, { dailyBuyVolume: number }>
): Set<string> {
  const excluded = new Set<string>();
  for (const [shardId, price] of Object.entries(prices)) {
    if (price.dailyBuyVolume < STABLE_MIN_DAILY_BUY_VOLUME) {
      excluded.add(shardId);
    }
  }
  return excluded;
}
