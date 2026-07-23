import type { CalculationParams, CalculationResult, RecipeOverride, Data, RecipeChoice, InventoryCalculationResult } from "../types/types";

type ProgressPhase = "parsing" | "computing" | "building" | "assigning" | "finalizing";

export type WorkerProgress = {
  phase: ProgressPhase;
  progress: number;
  message: string;
};

type WorkerMsg =
  | ({ type: "progress" } & WorkerProgress)
  | { type: "result"; result: CalculationResult; parsedData?: Data }
  | { type: "error"; message: string };

type WorkerStartMsg = {
  type: "start";
  targetShard: string;
  requiredQuantity: number;
  params: CalculationParams;
  recipeOverrides: RecipeOverride[];
  parsedData: Data;
};

type WorkerBatchStartWithDataMsg = {
  type: "batch-start-with-data";
  targets: Array<{ shard: string; quantity: number }>;
  params: CalculationParams;
  recipeOverrides: RecipeOverride[];
  parsedData: Data;
  choices: Record<string, RecipeChoice>;
  cycleNodes: string[][];
};

type WorkerBatchMsg =
  | ({ type: "progress" } & WorkerProgress)
  | { type: "batch-result"; results: CalculationResult[]; materialBreakdown?: Map<string, Map<string, number>> }
  | { type: "error"; message: string };

type InventoryWorkerMsg =
  | ({ type: "progress" } & WorkerProgress)
  | { type: "inventory-result"; result: InventoryCalculationResult; parsedData?: Data }
  | { type: "error"; message: string };

type InventoryWorkerStartMsg = {
  type: "inventory-calculation";
  targetShard: string;
  requiredQuantity: number;
  params: CalculationParams;
  recipeOverrides: RecipeOverride[];
  inventory: Record<string, number>;
  ownedAttributes: Record<string, number>;
  parsedData: Data;
};

export function calculateOptimalPathWithWorker(
  targetShard: string,
  requiredQuantity: number,
  params: CalculationParams,
  recipeOverrides: RecipeOverride[] = [],
  onProgress?: (p: WorkerProgress) => void
): { promise: Promise<{ result: CalculationResult; parsedData: Data }>; cancel: () => void } {
  const worker = new Worker(new URL("../workers/calculationWorker.ts", import.meta.url), { type: "module" });
  let cancelled = false;

  const promise = new Promise<{ result: CalculationResult; parsedData: Data }>(async (resolve, reject) => {
    try {
      const { CalculationService } = await import("../services/calculationService");
      const service = CalculationService.getInstance();

      onProgress?.({ phase: "parsing", progress: 0, message: "Parsing data..." });
      const parsedData = await service.parseData(params);

      if (cancelled) { worker.terminate(); reject(new Error("Cancelled")); return; }

      worker.onmessage = (event: MessageEvent<WorkerMsg>) => {
        const data = event.data;
        if (!data || !("type" in data)) return;
        if (data.type === "progress") {
          onProgress?.({ phase: data.phase, progress: data.progress, message: data.message });
        } else if (data.type === "result") {
          worker.terminate();
          resolve({ result: data.result, parsedData });
        } else if (data.type === "error") {
          worker.terminate();
          reject(new Error(data.message || "Worker calculation failed"));
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };

      const startMsg: WorkerStartMsg = {
        type: "start",
        targetShard,
        requiredQuantity,
        params,
        recipeOverrides,
        parsedData,
      };
      worker.postMessage(startMsg);
    } catch (err) {
      worker.terminate();
      reject(err);
    }
  });

  const cancel = () => {
    cancelled = true;
    worker.terminate();
  };

  return { promise, cancel };
}

export function calculateInventoryWithWorker(
  targetShard: string,
  requiredQuantity: number,
  params: CalculationParams,
  recipeOverrides: RecipeOverride[],
  inventory: Map<string, number>,
  ownedAttributes: Map<string, number>,
  onProgress?: (p: WorkerProgress) => void
): { promise: Promise<{ result: InventoryCalculationResult; parsedData: Data }>; cancel: () => void } {
  const worker = new Worker(new URL("../workers/calculationWorker.ts", import.meta.url), { type: "module" });
  let cancelled = false;

  const promise = new Promise<{ result: InventoryCalculationResult; parsedData: Data }>(async (resolve, reject) => {
    try {
      const { CalculationService } = await import("../services/calculationService");
      const service = CalculationService.getInstance();

      onProgress?.({ phase: "parsing", progress: 0, message: "Parsing data..." });
      const parsedData = await service.parseData(params);

      if (cancelled) { worker.terminate(); reject(new Error("Cancelled")); return; }

      const inventoryObj: Record<string, number> = {};
      inventory.forEach((value, key) => { inventoryObj[key] = value; });
      const ownedAttributesObj: Record<string, number> = {};
      ownedAttributes.forEach((value, key) => { ownedAttributesObj[key] = value; });

      worker.onmessage = (event: MessageEvent<InventoryWorkerMsg>) => {
        const data = event.data;
        if (!data || !("type" in data)) return;
        if (data.type === "progress") {
          onProgress?.({ phase: data.phase, progress: data.progress, message: data.message });
        } else if (data.type === "inventory-result") {
          worker.terminate();
          resolve({ result: data.result, parsedData });
        } else if (data.type === "error") {
          worker.terminate();
          reject(new Error(data.message || "Worker calculation failed"));
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };

      const startMsg: InventoryWorkerStartMsg = {
        type: "inventory-calculation",
        targetShard,
        requiredQuantity,
        params,
        recipeOverrides,
        inventory: inventoryObj,
        ownedAttributes: ownedAttributesObj,
        parsedData,
      };
      worker.postMessage(startMsg);
    } catch (err) {
      worker.terminate();
      reject(err);
    }
  });

  const cancel = () => {
    cancelled = true;
    worker.terminate();
  };

  return { promise, cancel };
}

export function calculateMultipleShardsParallel(
  targets: Array<{ shard: string; quantity: number }>,
  params: CalculationParams,
  recipeOverrides: RecipeOverride[] = [],
  onProgress?: (p: WorkerProgress) => void
): { promise: Promise<CalculationResult[]>; cancel: () => void } {
  const maxWorkers = Math.min(navigator.hardwareConcurrency || 4, 8, targets.length);

  const workers: Worker[] = [];
  const completedChunks: Map<number, CalculationResult[]> = new Map();
  const completedBreakdowns: Map<number, Map<string, Map<string, number>>> = new Map();
  const chunkProgress: Map<number, number> = new Map();
  const chunkPhases: Map<number, ProgressPhase> = new Map();
  let cancelled = false;
  const totalShards = targets.length;

  const promise = new Promise<CalculationResult[]>((resolve, reject) => {
    (async () => {
      try {
        onProgress?.({
          phase: "parsing",
          progress: 0,
          message: "Parsing data...",
        });

        const { CalculationService } = await import("../services/calculationService");
        const service = CalculationService.getInstance();
        const parsedData = await service.parseData(params);

        onProgress?.({
          phase: "computing",
          progress: 0,
          message: "Computing optimal costs...",
        });

        const { choices } = service.computeMinCosts(parsedData, params, recipeOverrides);
        const cycleNodes =
          params.crocodileLevel > 0 || recipeOverrides.length > 0
            ? service.findCycleNodes(choices)
            : [];

        const choicesObj: Record<string, RecipeChoice> = {};
        choices.forEach((value, key) => {
          choicesObj[key] = value;
        });

        onProgress?.({
          phase: "building",
          progress: 0,
          message: `Starting ${Math.min(maxWorkers, targets.length)} parallel workers...`,
        });

        const chunkSize = Math.ceil(targets.length / maxWorkers);
        const chunks: Array<Array<{ shard: string; quantity: number }>> = [];

        for (let i = 0; i < targets.length; i += chunkSize) {
          chunks.push(targets.slice(i, i + chunkSize));
        }

        chunks.forEach((_, idx) => {
          chunkProgress.set(idx, 0);
          chunkPhases.set(idx, "building");
        });

        const reportOverallProgress = () => {
          let totalCompleted = 0;
          chunkProgress.forEach((progress, chunkIdx) => {
            totalCompleted += progress * chunks[chunkIdx].length;
          });

          const overallProgress = totalCompleted / totalShards;
          const shardsCompleted = Math.floor(totalCompleted);

          onProgress?.({
            phase: "building",
            progress: overallProgress,
            message: `Calculating ${shardsCompleted} of ${totalShards} shards...`,
          });
        };

        chunks.forEach((chunk, chunkIndex) => {
          const worker = new Worker(new URL("../workers/calculationWorker.ts", import.meta.url), { type: "module" });
          workers.push(worker);

          worker.onmessage = (event: MessageEvent<WorkerBatchMsg>) => {
            if (cancelled) return;

            const data = event.data;
            if (!data || !("type" in data)) return;

            if (data.type === "progress") {
              chunkProgress.set(chunkIndex, data.progress);
              chunkPhases.set(chunkIndex, data.phase);
              reportOverallProgress();
            } else if (data.type === "batch-result") {
              worker.terminate();
              completedChunks.set(chunkIndex, data.results);
              if (data.materialBreakdown) {
                completedBreakdowns.set(chunkIndex, data.materialBreakdown);
              }
              chunkProgress.set(chunkIndex, 1);

              let totalCompleted = 0;
              chunkProgress.forEach((progress, idx) => {
                totalCompleted += progress * chunks[idx].length;
              });

              onProgress?.({
                phase: "finalizing",
                progress: totalCompleted / totalShards,
                message: `Completed ${Math.floor(totalCompleted)} of ${totalShards} shards...`,
              });

              if (completedChunks.size === chunks.length) {
                const allResults: CalculationResult[] = [];
                for (let i = 0; i < chunks.length; i++) {
                  const chunkResults = completedChunks.get(i);
                  if (chunkResults) {
                    allResults.push(...chunkResults);
                  }
                }

                const globalMaterialBreakdown = new Map<string, Map<string, number>>();
                completedBreakdowns.forEach((breakdown) => {
                  breakdown.forEach((targetMap, materialId) => {
                    if (!globalMaterialBreakdown.has(materialId)) {
                      globalMaterialBreakdown.set(materialId, new Map());
                    }
                    const globalTargetMap = globalMaterialBreakdown.get(materialId)!;
                    targetMap.forEach((qty, targetId) => {
                      globalTargetMap.set(targetId, (globalTargetMap.get(targetId) || 0) + qty);
                    });
                  });
                });

                allResults.forEach((result) => {
                  result.materialBreakdown = globalMaterialBreakdown;
                });

                resolve(allResults);
              }
            } else if (data.type === "error") {
              worker.terminate();
              workers.forEach((w) => w.terminate());
              reject(new Error(data.message || "Worker calculation failed"));
            }
          };

          worker.onerror = (err) => {
            if (cancelled) return;
            worker.terminate();
            workers.forEach((w) => w.terminate());
            reject(err);
          };

          const startMsg: WorkerBatchStartWithDataMsg = {
            type: "batch-start-with-data",
            targets: chunk,
            params,
            recipeOverrides,
            parsedData,
            choices: choicesObj,
            cycleNodes,
          };
          worker.postMessage(startMsg);
        });
      } catch (err) {
        workers.forEach((w) => w.terminate());
        reject(err);
      }
    })();
  });

  const cancel = () => {
    cancelled = true;
    workers.forEach((w) => w.terminate());
  };

  return { promise, cancel };
}