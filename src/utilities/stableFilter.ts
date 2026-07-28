import type { Data, Shards, Recipes, RecipeTree } from "../types/types";

export const STABLE_MIN_DAILY_BUY_VOLUME = 5000;
export const MIN_SELL_VOLUME = 3000;

export function isLowSellVolume(priceInfo: { dailySellVolume: number }): boolean {
  return priceInfo.dailySellVolume < MIN_SELL_VOLUME;
}

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

function collectExcludedDirects(node: RecipeTree | undefined | null, excluded: Set<string>, result: string[]): void {
  if (!node) return;
  if (node.method === "direct" && excluded.has(node.shard)) {
    result.push(node.shard);
  }
  if (node.method === "recipe") {
    collectExcludedDirects(node.inputs[0], excluded, result);
    collectExcludedDirects(node.inputs[1], excluded, result);
  }
  if (node.method === "cycle") {
    collectExcludedDirects(node.inputRecipe, excluded, result);
    for (const input of node.cycleInputs) {
      collectExcludedDirects(input, excluded, result);
    }
  }
}

function collectDirects(node: RecipeTree | undefined | null, result: string[]): void {
  if (!node) return;
  if (node.method === "direct") {
    result.push(node.shard);
  }
  if (node.method === "recipe") {
    collectDirects(node.inputs[0], result);
    collectDirects(node.inputs[1], result);
  }
  if (node.method === "cycle") {
    collectDirects(node.inputRecipe, result);
    for (const input of node.cycleInputs) {
      collectDirects(input, result);
    }
  }
}

export function computeSubstitutions(
  originalTree: RecipeTree | null,
  filteredTree: RecipeTree | null,
  excludedShardIds: Set<string>
): Map<string, string> {
  const substitutions = new Map<string, string>();

  const walk = (orig: RecipeTree | undefined | null, filt: RecipeTree | undefined | null) => {
    if (!orig || !filt) return;
    if (orig.shard !== filt.shard) {
      if (excludedShardIds.has(orig.shard) && !excludedShardIds.has(filt.shard)) {
        substitutions.set(filt.shard, orig.shard);
      }
    }
    if (orig.method === "recipe" && filt.method === "recipe") {
      walk(orig.inputs[0], filt.inputs[0]);
      walk(orig.inputs[1], filt.inputs[1]);
    } else if (orig.method === "cycle" && filt.method === "cycle") {
      walk(orig.inputRecipe, filt.inputRecipe);
      for (let i = 0; i < orig.cycleInputs.length; i++) {
        walk(orig.cycleInputs[i], filt.cycleInputs[i]);
      }
    } else if (orig.method !== filt.method) {
      const excludedInOrig: string[] = [];
      collectExcludedDirects(orig, excludedShardIds, excludedInOrig);
      if (excludedInOrig.length > 0) {
        const allFiltDirects: string[] = [];
        collectDirects(filt, allFiltDirects);
        const newDirects = allFiltDirects.filter(s => !excludedShardIds.has(s));
        let idx = 0;
        for (const ex of excludedInOrig) {
          if (idx < newDirects.length) {
            substitutions.set(newDirects[idx], ex);
            idx++;
          }
        }
      }
    }
  };

  walk(originalTree, filteredTree);
  return substitutions;
}
