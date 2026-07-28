import type { CalculationParams, CalculationResult, RecipeOverride, Data, InventoryCalculationResult, RecipeTree } from "../types/types";
import { CalculationService, InvCalculationService } from "../services";
import { applyStableFilter, computeSubstitutions } from "../utilities/stableFilter";

interface StartMsg {
  type: "start";
  targetShard: string;
  requiredQuantity: number;
  params: CalculationParams;
  recipeOverrides: RecipeOverride[];
  excludedShardIds?: string[];
  keepShardId?: string;
}

interface BatchStartWithDataMsg {
  type: "batch-start-with-data";
  targets: Array<{ shard: string; quantity: number }>;
  params: CalculationParams;
  recipeOverrides: RecipeOverride[];
  excludedShardIds?: string[];
}

interface InventoryCalculationMsg {
  type: "inventory-calculation";
  targetShard: string;
  requiredQuantity: number;
  params: CalculationParams;
  recipeOverrides: RecipeOverride[];
  inventory: Record<string, number>;
  ownedAttributes: Record<string, number>;
  excludedShardIds?: string[];
  keepShardId?: string;
}

type ProgressPhase = "parsing" | "computing" | "building" | "assigning" | "finalizing";

interface ProgressMsg {
  type: "progress";
  phase: ProgressPhase;
  progress: number;
  message: string;
}
interface ResultMsg {
  type: "result";
  result: CalculationResult;
  parsedData?: Data;
}
interface BatchResultMsg {
  type: "batch-result";
  results: CalculationResult[];
  materialBreakdown?: Map<string, Map<string, number>>;
  parsedData?: Data;
}
interface InventoryResultMsg {
  type: "inventory-result";
  result: InventoryCalculationResult;
  parsedData?: Data;
}
interface ErrorMsg {
  type: "error";
  message: string;
}

type OutMsg = ProgressMsg | ResultMsg | BatchResultMsg | InventoryResultMsg | ErrorMsg;

const post = (msg: OutMsg) => (postMessage as (m: OutMsg) => void)(msg);

let lastProgressTime = 0;
const PROGRESS_THROTTLE_MS = 100;

const postProgress = (phase: ProgressPhase, progress: number, message: string, force = false) => {
  const now = Date.now();
  if (force || now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
    lastProgressTime = now;
    post({ type: "progress", phase, progress, message });
  }
};

self.onmessage = async (e: MessageEvent<StartMsg | BatchStartWithDataMsg | InventoryCalculationMsg>) => {
  const data = e.data;
  if (!data || !data.type) return;

  if (data.type === "batch-start-with-data") {
    await handleBatchCalculationWithData(data);
  } else if (data.type === "start") {
    await handleSingleCalculation(data);
  } else if (data.type === "inventory-calculation") {
    await handleInventoryCalculation(data);
  }
};

async function handleSingleCalculation(data: StartMsg) {
  const { targetShard, requiredQuantity, params, recipeOverrides, excludedShardIds, keepShardId } = data;

  try {
    const service = CalculationService.getInstance();
    let parsedData = await service.parseData(params);

    const hasFilter = excludedShardIds && excludedShardIds.length > 0;
    const excludedSet = hasFilter ? new Set(excludedShardIds) : undefined;
    console.log("[Worker:Single] hasFilter:", hasFilter, "excludedCount:", excludedShardIds?.length ?? 0, "keepShardId:", keepShardId);

    let originalTree = null;
    if (hasFilter) {
      const { choices: origChoices } = service.computeMinCosts(parsedData, params, recipeOverrides);
      const origCycleNodes = params.crocodileLevel > 0 || recipeOverrides.length > 0 ? service.findCycleNodes(origChoices) : [];
      originalTree = service.buildRecipeTree(parsedData, targetShard, origChoices, origCycleNodes, params, recipeOverrides);
      console.log("[Worker:Single] originalTree:", originalTree ? `${originalTree.method}(${originalTree.shard})` : "null");
    }

    if (hasFilter) {
      parsedData = applyStableFilter(parsedData, excludedSet!, keepShardId);
    }

    if (!parsedData.shards[targetShard]) {
      const emptyResult: CalculationResult = {
        timePerShard: 0,
        totalTime: 0,
        totalShardsProduced: 0,
        craftsNeeded: 0,
        totalQuantities: new Map<string, number>(),
        craftTime: 0,
        tree: { shard: targetShard, method: "direct", quantity: 0 },
        substitutedShards: hasFilter ? computeSubstitutions(originalTree, { shard: targetShard, method: "direct", quantity: 0 }, excludedSet!) : undefined,
      };
      post({ type: "result", result: emptyResult, parsedData });
      return;
    }

    post({ type: "progress", phase: "computing", progress: 0, message: "Computing optimal costs..." });
    const { choices, minCosts } = service.computeMinCosts(parsedData, params, recipeOverrides);
    const minCostsCache = { minCosts, choices };

    post({ type: "progress", phase: "building", progress: 0.4, message: "Building recipe tree..." });
    const cycleNodes = params.crocodileLevel > 0 || recipeOverrides.length > 0 ? service.findCycleNodes(choices) : [];
    const tree = service.buildRecipeTree(parsedData, targetShard, choices, cycleNodes, params, recipeOverrides, minCostsCache);

    post({ type: "progress", phase: "assigning", progress: 0.7, message: "Assigning quantities..." });
    const craftCounter = { total: 0 };
    const { crocodileMultiplier } = service.calculateMultipliers(params);
    service.assignQuantities(tree, requiredQuantity, parsedData, craftCounter, choices, crocodileMultiplier, params, recipeOverrides);

    post({ type: "progress", phase: "finalizing", progress: 0.9, message: "Aggregating results..." });

    const { craftsNeeded, craftTime, totalQuantities } = service.collectTreeStats(tree, params);
    const { totalShardsProduced } = service.calculateShardProductionStats({
      requiredQuantity,
      targetShard,
      choices,
      crocodileMultiplier,
      totalQuantities,
      data: parsedData,
      params,
      getDirectCostFn: service.getDirectCost.bind(service),
    });

    const totalTime = service.calculateTotalTimeFromQuantities(totalQuantities, craftTime, parsedData, params);
    const timePerShard = totalTime / totalShardsProduced;

    const substitutedShards = hasFilter ? computeSubstitutions(originalTree, tree, excludedSet!) : undefined;
    if (hasFilter) {
      console.log("[Worker:Single] computeSubstitutions result:", substitutedShards?.size ?? 0, "entries", substitutedShards ? Object.fromEntries(substitutedShards) : "undefined");
    }

    const result: CalculationResult = {
      timePerShard,
      totalTime,
      totalShardsProduced,
      craftsNeeded,
      totalQuantities,
      craftTime,
      tree,
      substitutedShards,
    };

    post({ type: "progress", phase: "finalizing", progress: 1, message: "Done" });
    post({ type: "result", result, parsedData });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Worker calculation failed";
    post({ type: "error", message });
  }
}

async function handleBatchCalculationWithData(data: BatchStartWithDataMsg) {
  const { targets, params, recipeOverrides, excludedShardIds } = data;

  try {
    const service = CalculationService.getInstance();
    let parsedData = await service.parseData(params);

    const hasFilter = excludedShardIds && excludedShardIds.length > 0;
    const excludedSet = hasFilter ? new Set(excludedShardIds) : undefined;
    console.log("[Worker:Batch] hasFilter:", hasFilter, "excludedCount:", excludedShardIds?.length ?? 0);

    let originalParsedData: typeof parsedData | null = null;
    let originalChoices = null;
    let originalCycleNodes: ReturnType<typeof service.findCycleNodes> = [];
    if (hasFilter) {
      originalParsedData = parsedData;
      const origResult = service.computeMinCosts(parsedData, params, recipeOverrides);
      originalChoices = origResult.choices;
      originalCycleNodes = params.crocodileLevel > 0 || recipeOverrides.length > 0 ? service.findCycleNodes(originalChoices) : [];
    }

    if (hasFilter) {
      parsedData = applyStableFilter(parsedData, excludedSet!);
    }

    const { choices: choicesMap, minCosts } = service.computeMinCosts(parsedData, params, recipeOverrides);
    const choices = new Map(choicesMap);
    const minCostsCache = { minCosts, choices: new Map(choices) };

    const cycleNodes = params.crocodileLevel > 0 || recipeOverrides.length > 0 ? service.findCycleNodes(choices) : [];

    const results: CalculationResult[] = [];
    const { crocodileMultiplier } = service.calculateMultipliers(params);

    const materialBreakdown = new Map<string, Map<string, number>>();

    for (let i = 0; i < targets.length; i++) {
      const { shard: targetShard, quantity: requiredQuantity } = targets[i];

      if (!parsedData.shards[targetShard]) {
        const emptyResult: CalculationResult = {
          timePerShard: 0,
          totalTime: 0,
          totalShardsProduced: 0,
          craftsNeeded: 0,
          totalQuantities: new Map<string, number>(),
          craftTime: 0,
          tree: { shard: targetShard, method: "direct", quantity: 0 },
          materialBreakdown: new Map(),
        };
        results.push(emptyResult);

        postProgress("building", (i + 1) / targets.length, `Calculating ${i + 1} of ${targets.length} shards...`);
        continue;
      }

      let originalTree = null;
      if (hasFilter && originalChoices && originalParsedData) {
        originalTree = service.buildRecipeTree(originalParsedData, targetShard, originalChoices, originalCycleNodes, params, recipeOverrides);
      }

      const tree = service.buildRecipeTree(parsedData, targetShard, choices, cycleNodes, params, recipeOverrides, minCostsCache);

      const craftCounter = { total: 0 };
      service.assignQuantities(tree, requiredQuantity, parsedData, craftCounter, choices, crocodileMultiplier, params, recipeOverrides);

      const { craftsNeeded, craftTime, totalQuantities } = service.collectTreeStats(tree, params);

      totalQuantities.forEach((quantity, materialShardId) => {
        if (!materialBreakdown.has(materialShardId)) {
          materialBreakdown.set(materialShardId, new Map());
        }
        const targetMap = materialBreakdown.get(materialShardId)!;
        targetMap.set(targetShard, (targetMap.get(targetShard) || 0) + quantity);
      });

      const { totalShardsProduced } = service.calculateShardProductionStats({
        requiredQuantity,
        targetShard,
        choices,
        crocodileMultiplier,
        totalQuantities,
        data: parsedData,
        params,
        getDirectCostFn: service.getDirectCost.bind(service),
      });

      const totalTime = service.calculateTotalTimeFromQuantities(totalQuantities, craftTime, parsedData, params);
      const timePerShard = totalTime / totalShardsProduced;

      const substitutedShards = hasFilter ? computeSubstitutions(originalTree, tree, excludedSet!) : undefined;
      if (hasFilter && substitutedShards && substitutedShards.size > 0) {
        console.log("[Worker:Batch] substitutions for", targetShard, ":", Object.fromEntries(substitutedShards));
      }

      const result: CalculationResult = {
        timePerShard,
        totalTime,
        totalShardsProduced,
        craftsNeeded,
        totalQuantities,
        craftTime,
        tree,
        substitutedShards,
      };

      results.push(result);

      postProgress("building", (i + 1) / targets.length, `Calculating ${i + 1} of ${targets.length} shards...`);
    }

    post({ type: "progress", phase: "finalizing", progress: 1, message: "Done" });
    post({ type: "batch-result", results, materialBreakdown, parsedData });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Batch calculation failed";
    post({ type: "error", message });
  }
}

async function handleInventoryCalculation(data: InventoryCalculationMsg) {
  const { targetShard, requiredQuantity, params, recipeOverrides, inventory, ownedAttributes, excludedShardIds, keepShardId } = data;

  try {
    const service = CalculationService.getInstance();
    const invService = InvCalculationService.getInstance();
    let parsedData = await service.parseData(params);

    const hasFilter = excludedShardIds && excludedShardIds.length > 0;
    const excludedSet = hasFilter ? new Set(excludedShardIds) : undefined;
    console.log("[Worker:Inventory] hasFilter:", hasFilter, "excludedCount:", excludedShardIds?.length ?? 0, "keepShardId:", keepShardId);

    let originalTree = null;
    if (hasFilter) {
      const { choices: origChoices } = service.computeMinCosts(parsedData, params, recipeOverrides);
      const origCycleNodes = params.crocodileLevel > 0 || recipeOverrides.length > 0 ? service.findCycleNodes(origChoices) : [];
      originalTree = service.buildRecipeTree(parsedData, targetShard, origChoices, origCycleNodes, params, recipeOverrides);
    }

    if (hasFilter) {
      parsedData = applyStableFilter(parsedData, excludedSet!, keepShardId);
    }
    const inventoryMap = new Map(Object.entries(inventory));
    const ownedAttributesMap = new Map(Object.entries(ownedAttributes));

    if (!parsedData.shards[targetShard]) {
      const emptyResult: InventoryCalculationResult = {
        timePerShard: 0,
        totalTime: 0,
        totalShardsProduced: 0,
        craftsNeeded: 0,
        totalQuantities: new Map<string, number>(),
        craftTime: 0,
        tree: { shard: targetShard, method: "direct", quantity: 0 },
        substitutedShards: hasFilter ? computeSubstitutions(originalTree, { shard: targetShard, method: "direct", quantity: 0 }, excludedSet!) : undefined,
      };
      post({ type: "inventory-result", result: emptyResult, parsedData });
      return;
    }

    const result = await invService.calculateOptimalPath(
      targetShard,
      requiredQuantity,
      params,
      inventoryMap,
      recipeOverrides,
      ownedAttributesMap,
      parsedData
    );

    if (hasFilter) {
      result.substitutedShards = computeSubstitutions(originalTree, result.tree as RecipeTree | null, excludedSet!);
      console.log("[Worker:Inventory] substitutions:", result.substitutedShards?.size ?? 0, "entries");
    }

    post({ type: "progress", phase: "finalizing", progress: 1, message: "Done" });
    post({ type: "inventory-result", result, parsedData });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Inventory calculation failed";
    post({ type: "error", message });
  }
}