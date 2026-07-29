import { useState, useEffect, useCallback, useRef } from "react";
import { TrendingUp, TrendingDown, BarChart3, RefreshCw, AlertCircle, Info, ShieldCheck, ShieldX, AlertTriangle, Hammer, Clock } from "lucide-react";
import { useFusionData } from "../hooks";
import { getRarityColor, formatLargeNumber, saveBazaarCache, loadBazaarCache, DEFAULT_CALCULATION_PARAMS, buildDataFromFusionData, detectPriceAnomaly, collectTreeShardIds } from "../utilities";
import { applyStableFilter, getUnstableShardIds, STABLE_MIN_DAILY_BUY_VOLUME, isLowSellVolume, MIN_SELL_VOLUME } from "../utilities/stableFilter";
import { DataService } from "../services/dataService";
import { CalculationService } from "../services/calculationService";
import { RecipeTreeNode } from "../components/tree";
import type { RecipeTree, PriceInfo, Data, RecipeChoice } from "../types/types";

interface ProfitEntry {
  shardId: string;
  shardName: string;
  rarity: string;
  buyCost: number;
  sellRevenue: number;
  craftCost: number;
  profit: number;
  margin: number;
  tree: RecipeTree | null;
  volumeOk: boolean;
  volatileOk: boolean;
  lowVolumeShards: string[];
  volatileShards: string[];
  totalQuantities: Map<string, number> | null;
  craftsNeeded: number;
  outputQty: number;
}

type ShardBase = {
  shardId: string; shardName: string; rarity: string;
  outputQty: number; tree: RecipeTree | null;
  totalQuantities: Map<string, number> | null;
  craftsNeeded: number;
  volumeOk: boolean; volatileOk: boolean;
  lowVolumeShards: string[]; volatileShards: string[];
};

function computeEntriesForMode(
  shardBases: ShardBase[],
  prices: Record<string, PriceInfo>,
  buyMode: "order" | "instant",
  sellMode: "order" | "instant",
  viewMode: "craft" | "flip"
): ProfitEntry[] {
  const entries: ProfitEntry[] = [];

  for (const base of shardBases) {
    const priceInfo = prices[base.shardId];
    if (!priceInfo) continue;

    const buyCost = buyMode === "instant" ? priceInfo.sellRevenue : priceInfo.buyCost;
    let sellRevenue = sellMode === "instant" ? priceInfo.buyCost : priceInfo.sellRevenue;

    if (buyCost <= 0 || sellRevenue <= 0 || !isFinite(buyCost) || !isFinite(sellRevenue)) continue;

    let profit: number;
    let margin: number;
    let craftCost = Infinity;

    if (viewMode === "craft") {
      if (base.totalQuantities && base.totalQuantities.size > 0) {
        let totalMatCost = 0;
        let allMaterialsPriced = true;
        base.totalQuantities.forEach((qty, matId) => {
          const matPriceInfo = prices[matId];
          const matPrice = matPriceInfo ? (buyMode === "instant" ? matPriceInfo.sellRevenue : matPriceInfo.buyCost) : undefined;
          if (matPrice === undefined || matPrice === null || matPrice <= 0) {
            allMaterialsPriced = false;
          }
          totalMatCost += qty * (matPrice ?? 0);
        });
        if (allMaterialsPriced) {
          craftCost = totalMatCost;
        }
      }
      if (isFinite(craftCost)) {
        sellRevenue = (sellMode === "instant" ? priceInfo.buyCost : priceInfo.sellRevenue) * base.outputQty;
        profit = sellRevenue - craftCost;
        margin = (craftCost > 0) ? (profit / craftCost) * 100 : 0;
      } else {
        profit = -Infinity;
        margin = 0;
      }
    } else {
      profit = sellRevenue - buyCost;
      margin = buyCost > 0 ? (profit / buyCost) * 100 : 0;
    }

    entries.push({
      ...base,
      buyCost,
      sellRevenue,
      craftCost,
      profit,
      margin,
    });
  }

  return entries;
}

export const ProfitabilityPage = () => {
  const { fusionData, loading: fusionLoading } = useFusionData();
  const [prices, setPrices] = useState<Record<string, PriceInfo> | null>(null);
  const [priceLoading, setPriceLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ProfitEntry[]>([]);
  const [heavyDataVersion, setHeavyDataVersion] = useState(0);
  const heavyDataRef = useRef<{
    data: Data;
    choices: Map<string, RecipeChoice>;
    cycleNodes: string[][];
    shardBases: ShardBase[];
  } | null>(null);
  const entriesCacheRef = useRef<Map<string, ProfitEntry[]>>(new Map());
  const cacheBuiltForRef = useRef<{ version: number; prices: Record<string, PriceInfo> | null }>({ version: 0, prices: null });
  const [sortBy, setSortBy] = useState<"profit" | "margin">("profit");
  const [refreshing, setRefreshing] = useState(false);
  const [filterLowVolume, setFilterLowVolume] = useState(true);
  const [filterVolatile, setFilterVolatile] = useState(true);
  const [viewMode, setViewMode] = useState<"craft" | "flip">("craft");
  const [buyMode, setBuyMode] = useState<"order" | "instant">("order");
  const [sellMode, setSellMode] = useState<"order" | "instant">("order");
  const [finalQuantities, setFinalQuantities] = useState<Map<string, number>>(new Map());
  const [treeData, setTreeData] = useState<Data | null>(null);
  const [expandedStates, setExpandedStates] = useState<Map<string, boolean>>(new Map());
  const [staleShardIds, setStaleShardIds] = useState<Set<string>>(new Set());
  const [suspiciousPriceShards, setSuspiciousPriceShards] = useState<Set<string>>(new Set());
  const previousPricesRef = useRef<Record<string, { buyCost: number; sellRevenue: number }> | null>(null);
  const pricesRef = useRef<Record<string, PriceInfo> | null>(null);
  const backgroundFetchDoneRef = useRef(false);

  const fetchPrices = useCallback(async () => {
    setError(null);
    const dataService = DataService.getInstance();
    const shards = await dataService.loadShards();

    // Phase 1: Instant load from localStorage cache
    if (!backgroundFetchDoneRef.current) {
      const cached = loadBazaarCache();
      if (cached) {
        const cachedPrices: Record<string, PriceInfo> = {};
        const currentPriceSnapshot: Record<string, { buyCost: number; sellRevenue: number }> = {};
        for (const shard of shards) {
          const cachedPrice = cached.prices[shard.id];
          if (cachedPrice) {
            cachedPrices[shard.id] = cachedPrice;
            currentPriceSnapshot[shard.id] = { buyCost: cachedPrice.buyCost, sellRevenue: cachedPrice.sellRevenue };
          }
        }
        previousPricesRef.current = currentPriceSnapshot;
        setStaleShardIds(new Set(Object.keys(cachedPrices)));
        setPrices(cachedPrices);
        pricesRef.current = cachedPrices;
        setPriceLoading(false);
      }
    }

    // Phase 2: Fetch fresh prices in background
    try {
      const skyCoflPrices = await dataService.fetchSkyCoflBazaarPrices(shards);

      const newPrices: Record<string, PriceInfo> = {};
      const freshShardIds = new Set<string>();
      const currentPriceSnapshot: Record<string, { buyCost: number; sellRevenue: number }> = {};
      if (skyCoflPrices) {
        for (const shard of shards) {
          const info = skyCoflPrices[shard.id];
          if (info && info.buyCost > 0 && info.sellRevenue > 0) {
            newPrices[shard.id] = info;
            freshShardIds.add(shard.id);
            currentPriceSnapshot[shard.id] = { buyCost: info.buyCost, sellRevenue: info.sellRevenue };
          }
        }
      }

      // Capture previous prices for stale detection and merge
      const prevPriceData = pricesRef.current;

      // Merge: keep previous prices for shards not refreshed, replace with fresh data otherwise
      const mergedPrices: Record<string, PriceInfo> = { ...(prevPriceData ?? {}) };
      for (const [id, info] of Object.entries(newPrices)) {
        mergedPrices[id] = info;
      }

      // Determine stale shards: shards that existed before but weren't refreshed
      const stale = new Set<string>();
      for (const shard of shards) {
        if (!freshShardIds.has(shard.id) && prevPriceData?.[shard.id]) {
          stale.add(shard.id);
        }
      }

      setStaleShardIds(stale);
      setPrices(mergedPrices);
      pricesRef.current = mergedPrices;
      previousPricesRef.current = currentPriceSnapshot;

      // Only save to cache if we got meaningful fresh data (don't overwrite valid cache with empty)
      if (Object.keys(newPrices).length > 0) {
        saveBazaarCache(mergedPrices);
      }

      backgroundFetchDoneRef.current = true;
    } catch (err) {
      if (!backgroundFetchDoneRef.current) {
        setError(err instanceof Error ? err.message : "Failed to fetch bazaar prices");
      }
    } finally {
      setPriceLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrices();
  }, [fetchPrices]);

  // Keep pricesRef in sync with prices state (needed inside fetchPrices closure)
  useEffect(() => {
    pricesRef.current = prices;
  }, [prices]);

  useEffect(() => {
    if (!fusionData || !prices || fusionLoading || priceLoading) return;

    let cancelled = false;

    (async () => {
      try {
        if (!prices) return;
        const currentPrices = prices;
        const shardData = fusionData.shards;

        const dataService = DataService.getInstance();
        const defaultRates = await dataService.loadDefaultRates();

        let data = buildDataFromFusionData(fusionData, defaultRates);

        if (cancelled) return;

        const params = DEFAULT_CALCULATION_PARAMS;
        const service = CalculationService.getInstance();

        if (filterLowVolume) {
          const excludedIds = getUnstableShardIds(currentPrices);
          if (excludedIds.size > 0) {
            data = applyStableFilter(data, excludedIds);
          }
        }

        const { choices, minCosts } = service.computeMinCosts(data, params);
        const cycleNodes = service.findCycleNodes(choices);
        const minCostsCache = { minCosts, choices };

        if (cancelled) return;

        const shardBases: ShardBase[] = [];
        for (const [shardId, shard] of Object.entries(shardData)) {
          const priceInfo = currentPrices[shardId];
          if (!priceInfo) continue;
          if (filterLowVolume && isLowSellVolume(priceInfo)) continue;

          let effectiveTree: RecipeTree | null = null;
          let entryCraftsNeeded = 0;
          let entryTotalQuantities: Map<string, number> | null = null;
          let entryOutputQty = 1;

          if (data.recipes[shardId]?.length) {
            const choice = choices.get(shardId);
            if (choice && choice.recipe !== null) {
              entryOutputQty = service.getEffectiveOutputQuantity(choice.recipe, 1);
              const tree = service.buildRecipeTree(data, shardId, choices, cycleNodes, params, [], minCostsCache);
              service.assignQuantities(tree, entryOutputQty, data, { total: 0 }, choices, 1, params);
              effectiveTree = tree;
              const stats = service.collectTreeStats(tree, params);
              entryCraftsNeeded = stats.craftsNeeded;
              entryTotalQuantities = stats.totalQuantities;
            }
          }

          const volumeOk = priceInfo.dailyBuyVolume >= STABLE_MIN_DAILY_BUY_VOLUME && priceInfo.dailySellVolume >= MIN_SELL_VOLUME;

          shardBases.push({
            shardId,
            shardName: shard.name,
            rarity: shard.rarity,
            outputQty: entryOutputQty,
            tree: effectiveTree,
            totalQuantities: entryTotalQuantities,
            craftsNeeded: entryCraftsNeeded,
            volumeOk,
            volatileOk: true,
            lowVolumeShards: [],
            volatileShards: [],
          });
        }

        if (!cancelled) {
          heavyDataRef.current = { data, choices, cycleNodes, shardBases };
          setTreeData(data);
          setHeavyDataVersion(v => v + 1);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Computation failed");
      }
    })();

    return () => { cancelled = true; };
  }, [fusionData, prices, fusionLoading, priceLoading, filterLowVolume]);

  useEffect(() => {
    if (heavyDataVersion === 0 || !heavyDataRef.current || !prices) return;

    if (cacheBuiltForRef.current.version !== heavyDataVersion || cacheBuiltForRef.current.prices !== prices) {
      const { shardBases } = heavyDataRef.current;
      const cache = new Map<string, ProfitEntry[]>();
      const modes: Array<["order" | "instant", "order" | "instant", "craft" | "flip"]> = [
        ["order", "order", "craft"], ["order", "order", "flip"],
        ["order", "instant", "craft"], ["order", "instant", "flip"],
        ["instant", "order", "craft"], ["instant", "order", "flip"],
        ["instant", "instant", "craft"], ["instant", "instant", "flip"],
      ];
      for (const [bm, sm, vm] of modes) {
        cache.set(`${bm}-${sm}-${vm}`, computeEntriesForMode(shardBases, prices, bm, sm, vm));
      }
      entriesCacheRef.current = cache;
      cacheBuiltForRef.current = { version: heavyDataVersion, prices };
    }

    const entries = entriesCacheRef.current.get(`${buyMode}-${sellMode}-${viewMode}`) ?? [];

    const filtered = entries.filter((e) => {
      if (viewMode === "craft") {
        if (!isFinite(e.craftCost) || e.craftCost <= 0) return false;
      } else {
        if (e.profit <= 0) return false;
      }
      return true;
    });
    filtered.sort((a, b) => (sortBy === "profit" ? b.profit - a.profit : b.margin - a.margin));

    const top10 = filtered.slice(0, 10);

    const newExpanded = new Map<string, boolean>();
    const initExpansion = (tree: RecipeTree, id: string) => {
      if (tree.method === "recipe" || tree.method === "cycle") {
        newExpanded.set(id, true);
      }
      if (tree.method === "recipe") {
        initExpansion(tree.inputs[0], `${id}-0`);
        initExpansion(tree.inputs[1], `${id}-1`);
      }
      if (tree.method === "cycle") {
        initExpansion(tree.inputRecipe, `${id}-input`);
        tree.cycleInputs.forEach((ci, i) => initExpansion(ci, `${id}-cycle-${i}`));
      }
    };
    top10.forEach((entry, i) => {
      if (entry.tree) initExpansion(entry.tree, `profit-${i}`);
    });
    setExpandedStates(newExpanded);
    setResults(top10);
  }, [heavyDataVersion, prices, buyMode, sellMode, viewMode, filterLowVolume, filterVolatile, sortBy]);

  const handleRefresh = async () => {
    setRefreshing(true);
    backgroundFetchDoneRef.current = false;
    setPriceLoading(true);
    await fetchPrices();
    setRefreshing(false);
  };

  // Fetch price history for "Safe" anomaly detection
  useEffect(() => {
    if (!filterVolatile || !treeData || !prices) {
      return;
    }

    const treesWithShards: string[] = [];
    for (const entry of results) {
      if (entry.tree) {
        treesWithShards.push(...collectTreeShardIds(entry.tree, treeData.shards));
      }
    }
    const uniqueInternalIds = [...new Set(treesWithShards)];
    if (uniqueInternalIds.length === 0) return;

    let cancelled = false;

    DataService.getInstance()
      .fetchPriceHistoriesForShards(uniqueInternalIds)
      .then((histories) => {
        if (cancelled) return;

        const suspicious = new Set<string>();
        for (const [internalId, history] of histories) {
          const shardEntry = Object.entries(treeData.shards).find(
            ([, s]) => s.internal_id === internalId
          );
          if (!shardEntry) continue;
          const shardId = shardEntry[0];

          const priceInfo = prices[shardId];
          if (!priceInfo) continue;

          const anomaly = detectPriceAnomaly(priceInfo.sellRevenue, history, "sell");
          if (anomaly.isAnomalous) {
            suspicious.add(shardId);
          }
        }

        setSuspiciousPriceShards(suspicious);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [filterVolatile, results, treeData, prices]);

  const handleToggle = useCallback((nodeId: string) => {
    setExpandedStates((prev) => {
      const next = new Map(prev);
      next.set(nodeId, !next.get(nodeId));
      return next;
    });
  }, []);

  const handleFinalQuantityChange = useCallback((entryShardId: string, qty: number) => {
    setFinalQuantities((prev) => {
      const next = new Map(prev);
      next.set(entryShardId, qty);
      return next;
    });
  }, []);

  const isLoading = fusionLoading || priceLoading;

  return (
    <div className="min-h-screen">
      <div className="px-2 sm:px-4 py-4 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold text-amber-300 flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Profitability
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {viewMode === "craft"
                ? `Buy materials via ${buyMode === "order" ? "buy order" : "instant buy"} → craft using recipe tree → sell via ${sellMode === "order" ? "sell order" : "instant sell"}`
                : `Buy shard directly on bazaar → resell for profit`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-800 rounded-md border border-slate-700 text-xs">
              <button
                className={`px-2 py-1.5 rounded-l-md transition-colors cursor-pointer ${viewMode === "craft" ? "bg-purple-500/20 text-purple-300" : "text-slate-400 hover:text-slate-300"}`}
                onClick={() => setViewMode("craft")}
              >
                Craft
              </button>
              <button
                className={`px-2 py-1.5 rounded-r-md transition-colors cursor-pointer ${viewMode === "flip" ? "bg-purple-500/20 text-purple-300" : "text-slate-400 hover:text-slate-300"}`}
                onClick={() => setViewMode("flip")}
              >
                Flip
              </button>
            </div>
            <div className="flex bg-slate-800 rounded-md border border-slate-700 text-xs">
              <button
                className={`px-2 py-1.5 rounded-l-md transition-colors cursor-pointer ${sortBy === "profit" ? "bg-amber-500/20 text-amber-300" : "text-slate-400 hover:text-slate-300"}`}
                onClick={() => setSortBy("profit")}
              >
                Profit
              </button>
              <button
                className={`px-2 py-1.5 rounded-r-md transition-colors cursor-pointer ${sortBy === "margin" ? "bg-amber-500/20 text-amber-300" : "text-slate-400 hover:text-slate-300"}`}
                onClick={() => setSortBy("margin")}
              >
                Margin %
              </button>
            </div>
            <button
              onClick={() => setFilterLowVolume(!filterLowVolume)}
              className={`px-2 py-1.5 rounded-md text-xs border transition-colors cursor-pointer ${filterLowVolume ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-300"}`}
              title={filterLowVolume ? "Filtrer les shards à faible volume d'achat" : "Afficher tous les shards"}
            >
              <ShieldCheck className="w-3.5 h-3.5 inline-block mr-1" />
              {filterLowVolume ? "Stable" : "All"}
            </button>
            <button
              onClick={() => setFilterVolatile(!filterVolatile)}
              className={`px-2 py-1.5 rounded-md text-xs border transition-colors cursor-pointer ${filterVolatile ? "bg-amber-500/20 text-amber-300 border-amber-500/30" : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-300"}`}
              title={filterVolatile ? "Détecter les prix anormaux via l'historique SkyCofl" : "Afficher tous les shards"}
            >
              <AlertTriangle className="w-3.5 h-3.5 inline-block mr-1" />
              {filterVolatile ? "Safe" : "All"}
            </button>
            <div className="flex bg-slate-800 rounded-md border border-slate-700 text-xs">
              <button
                className={`px-2 py-1.5 rounded-l-md transition-colors cursor-pointer ${buyMode === "order" ? "bg-purple-500/20 text-purple-300" : "text-slate-400 hover:text-slate-300"}`}
                onClick={() => setBuyMode("order")}
              >
                  Buy Order
              </button>
              <button
                className={`px-2 py-1.5 rounded-r-md transition-colors cursor-pointer ${buyMode === "instant" ? "bg-purple-500/20 text-purple-300" : "text-slate-400 hover:text-slate-300"}`}
                onClick={() => setBuyMode("instant")}
              >
                Instant
              </button>
            </div>
            <div className="flex bg-slate-800 rounded-md border border-slate-700 text-xs">
              <button
                className={`px-2 py-1.5 rounded-l-md transition-colors cursor-pointer ${sellMode === "order" ? "bg-purple-500/20 text-purple-300" : "text-slate-400 hover:text-slate-300"}`}
                onClick={() => setSellMode("order")}
              >
                  Sell Order
              </button>
              <button
                className={`px-2 py-1.5 rounded-r-md transition-colors cursor-pointer ${sellMode === "instant" ? "bg-purple-500/20 text-purple-300" : "text-slate-400 hover:text-slate-300"}`}
                onClick={() => setSellMode("instant")}
              >
                Instant
              </button>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing || isLoading}
              className="p-1.5 rounded-md bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh prices"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {isLoading && !error && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
            <p className="text-slate-300 text-sm mb-1">Failed to load bazaar prices</p>
            <p className="text-slate-500 text-xs mb-3">{error}</p>
            <button
              onClick={handleRefresh}
              className="px-3 py-1.5 text-xs rounded-md bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 cursor-pointer transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {!isLoading && !error && staleShardIds.size > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300">
            <Clock className="w-4 h-4 flex-shrink-0" />
            <span>Prix de {staleShardIds.size} shard{staleShardIds.size > 1 ? "s" : ""} possibly outdated — updating in background.</span>
          </div>
        )}

        {!isLoading && !error && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BarChart3 className="w-8 h-8 text-slate-500 mb-3" />
            <p className="text-slate-400 text-sm">No profitable shards found</p>
            <p className="text-slate-500 text-xs mt-1">Prices may not be available for all shards.</p>
          </div>
        )}

        {!isLoading && !error && results.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/60 border border-slate-700/50 rounded-lg text-xs text-slate-300">
              <Info className="w-4 h-4 flex-shrink-0 text-amber-400" />
              <span>Achat 24h &ge; <strong>{formatLargeNumber(STABLE_MIN_DAILY_BUY_VOLUME)}</strong>, Vente 24h &ge; <strong>{formatLargeNumber(MIN_SELL_VOLUME)}</strong> requis — <ShieldCheck className="w-3 h-3 inline-block text-emerald-400" /> <strong>Stable</strong> filtre le volume. <AlertTriangle className="w-3 h-3 inline-block text-amber-400" /> <strong>Safe</strong> détecte les prix anormaux (pas de filtre, avertissement).</span>
            </div>
            {results.map((entry) => {
              const isProfitable = entry.profit > 0;
              const outVol = prices?.[entry.shardId];
              return (
                <div
                  key={entry.shardId}
                  className={`bg-slate-800/40 border rounded-lg overflow-hidden ${!entry.volumeOk ? "border-red-700/30" : "border-slate-700/50"}`}
                >
                  <div className="p-3">
                    <div className="flex items-center gap-3">
                      {entry.volumeOk ? (
                        <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      ) : (
                        <ShieldX className="w-4 h-4 text-red-400 flex-shrink-0" />
                      )}
                      <img
                        src={`${import.meta.env.BASE_URL}shardIcons/${entry.shardId}.png`}
                        alt={entry.shardName}
                        className="w-7 h-7 object-contain flex-shrink-0"
                        loading="lazy"
                      />
                        <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold text-sm ${getRarityColor(entry.rarity)}`}>{entry.shardName}</span>
                          {staleShardIds.has(entry.shardId) && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded" title="Prix possibly outdated — refreshing in background">
                              outdated
                            </span>
                          )}
                          {viewMode === "craft" && entry.tree && entry.totalQuantities && entry.totalQuantities.size > 0 && (
                            <input
                              type="number"
                              min={entry.outputQty}
                              step={entry.outputQty}
                              value={finalQuantities.get(entry.shardId) ?? entry.outputQty}
                              onChange={(e) => {
                                const v = parseInt(e.target.value);
                                if (!isNaN(v) && v >= entry.outputQty && v % entry.outputQty === 0) handleFinalQuantityChange(entry.shardId, v);
                              }}
                              className="w-12 bg-slate-800 text-white text-center rounded border border-slate-600 py-0.5 text-[11px] outline-none focus:border-purple-500"
                            />
                          )}
                          <span className="text-[10px] uppercase tracking-wider text-slate-500">{entry.rarity}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 lg:gap-6 text-xs flex-shrink-0">
                        <div className="text-right">
                          <div className="text-slate-500">Buy</div>
                          <div className="text-slate-300 font-medium">{formatLargeNumber(entry.buyCost)}</div>
                        </div>
                        {viewMode === "craft" && (
                          <div className="text-right">
                            <div className="text-slate-500">Craft</div>
                            <div className="text-amber-300 font-medium">{isFinite(entry.craftCost) ? formatLargeNumber(entry.craftCost) : "—"}</div>
                          </div>
                        )}
                        <div className="text-right">
                          <div className="text-slate-500">Sell</div>
                          <div className="text-slate-300 font-medium">{formatLargeNumber(entry.sellRevenue)}</div>
                        </div>
                        <div className="text-right min-w-[80px]">
                          <div className="text-slate-500">Profit</div>
                          <div className={`font-semibold flex items-center gap-1 justify-end ${isProfitable ? "text-green-400" : "text-red-400"}`}>
                            {isProfitable ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {formatLargeNumber(entry.profit)}
                          </div>
                        </div>
                        <div className="text-right min-w-[60px]">
                          <div className="text-slate-500">Margin</div>
                          <div className={`font-semibold ${isProfitable ? "text-green-400" : "text-red-400"}`}>
                            {entry.margin >= 0 ? "+" : ""}{entry.margin.toFixed(1)}%
                          </div>
                        </div>
                      </div>
                    </div>

                    {entry.lowVolumeShards.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-red-400">
                        <ShieldX className="w-3 h-3" />
                        <span>Volume 24h insuffisant: {entry.lowVolumeShards.map((id) => fusionData!.shards[id]?.name ?? id).join(", ")}</span>
                      </div>
                    )}

                    {(() => {
                      if (filterVolatile && entry.tree) {
                        const treeShards = collectTreeShardIds(entry.tree, treeData!.shards);
                        const suspiciousInEntry = treeShards.filter(id => suspiciousPriceShards.has(id));
                        if (suspiciousInEntry.length > 0) {
                          return (
                            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-400">
                              <AlertTriangle className="w-3 h-3" />
                              <span>Prix anormal détecté: {suspiciousInEntry.map((id) => fusionData!.shards[id]?.name ?? id).join(", ")}</span>
                            </div>
                          );
                        }
                      }
                      return null;
                    })()}

                    {viewMode === "craft" && entry.tree && entry.tree.method !== "direct" && treeData && (
                      <div className="mt-2 pt-2 border-t border-slate-700/30">
                        <RecipeTreeNode
                          tree={entry.tree}
                          data={treeData}
                          isTopLevel={true}
                          totalShardsProduced={finalQuantities.get(entry.shardId) ?? entry.outputQty}
                          nodeId={`profit-${results.indexOf(entry)}`}
                          expandedStates={expandedStates}
                          onToggle={handleToggle}
                          noWoodenBait={false}
                          ironManView={false}
                          bazaarPrices={prices ?? undefined}
                          filterLowVolume={filterLowVolume}
                          filterVolatile={filterVolatile}
                          suspiciousPriceShards={suspiciousPriceShards}
                        />
                      </div>
                    )}

                    {viewMode === "craft" && entry.totalQuantities && entry.totalQuantities.size > 0 && (() => {
                      const finalQty = finalQuantities.get(entry.shardId) ?? entry.outputQty;
                      const numCrafts = finalQty / entry.outputQty;
                      let totalCost = 0;
                      let displayAllPriced = true;
                      entry.totalQuantities.forEach((origQty, matId) => {
                        const qty = origQty * numCrafts;
                        const price = buyMode === "instant" ? prices?.[matId]?.sellRevenue : prices?.[matId]?.buyCost;
                        if (price === undefined || price === null || price <= 0) {
                          displayAllPriced = false;
                        }
                        totalCost += qty * (price ?? 0);
                      });
                      const displaySell = (entry.sellRevenue / entry.outputQty) * finalQty;
                      const displayProfit = displaySell - totalCost;
                      const displayMargin = totalCost > 0 ? (displayProfit / totalCost) * 100 : 0;

                      return (
                        <div className="mt-2 pt-2 border-t border-slate-700/30">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <Hammer className="w-3.5 h-3.5 text-blue-400" />
                            <span className="text-xs font-medium text-slate-300">Matériaux à acheter</span>
                            <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded">
                              {finalQty}x {entry.shardName}
                            </span>
                            {numCrafts > 1 && (
                              <span className="text-[10px] text-slate-500">({numCrafts} crafts)</span>
                            )}
                            <span className="text-[10px] text-slate-500">— coût {displayAllPriced ? formatLargeNumber(totalCost) : "N/A"}</span>
                            <span className={`text-[10px] font-medium ${displayAllPriced ? (displayProfit >= 0 ? "text-green-400" : "text-red-400") : "text-slate-500"}`}>
                              — profit {displayAllPriced ? `${formatLargeNumber(displayProfit)} (${displayMargin >= 0 ? "+" : ""}${displayMargin.toFixed(1)}%)` : "N/A (prix manquants)"}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                            {Array.from(entry.totalQuantities)
                              .sort(([, a], [, b]) => b - a)
                              .map(([shardId, origQty]) => {
                                const shardInfo = treeData?.shards[shardId];
                                const shardPrice = prices?.[shardId];
                                const qty = origQty * numCrafts;
                                return (
                                  <div key={shardId} className="flex items-center gap-1.5 px-2 py-1 bg-slate-900/50 rounded border border-slate-700/30 text-[11px]">
                                    <img
                                      src={`${import.meta.env.BASE_URL}shardIcons/${shardId}.png`}
                                      alt={shardInfo?.name ?? shardId}
                                      className="w-3.5 h-3.5 object-contain flex-shrink-0"
                                      loading="lazy"
                                    />
                                    <span className={`truncate ${getRarityColor(shardInfo?.rarity ?? "common")}`}>{shardInfo?.name ?? shardId}</span>
                                    <span className="text-slate-300 font-medium ml-auto flex-shrink-0">{Math.ceil(qty)}x</span>
                                    {shardPrice ? (
                                      <span className="text-slate-500 ml-auto flex-shrink-0">{formatLargeNumber(qty * (buyMode === "instant" ? shardPrice.sellRevenue : shardPrice.buyCost))}</span>
                                    ) : (
                                      <span className="text-red-400 ml-auto flex-shrink-0">?</span>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      );
                    })()}
                    {outVol && (
                      <div className="mt-1.5 flex gap-3 text-[11px] text-slate-500">
                        <span>Achat 24h: <span className={outVol.dailyBuyVolume >= STABLE_MIN_DAILY_BUY_VOLUME ? "text-slate-300" : "text-red-400"}>{formatLargeNumber(outVol.dailyBuyVolume)}</span></span>
                        <span>Vente 24h: <span className={outVol.dailySellVolume >= MIN_SELL_VOLUME ? "text-slate-300" : "text-red-400"}>{formatLargeNumber(outVol.dailySellVolume)}</span></span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfitabilityPage;
