import React from "react";
import { getRarityColor, formatShardDescription, formatLargeNumber } from "../../utilities";
import { GeckoIcon } from "../ui/GeckoIcon";
import { ChevronDown, ChevronRight, MoveRight, Settings, AlertTriangle, ShieldX, ArrowLeftRight } from "lucide-react";
import { formatNumber } from "../../utilities";
import type { RecipeTreeNodeProps, Recipe, Shard, RecipeTree } from "../../types/types";
import { Tooltip } from "../ui";
import { SHARD_DESCRIPTIONS } from "../../constants";
import { STABLE_MIN_DAILY_BUY_VOLUME, STABLE_MIN_DAILY_SELL_VOLUME } from "../../utilities/stableFilter";

export const RecipeTreeNode: React.FC<RecipeTreeNodeProps> = ({
  tree,
  data,
  isTopLevel = false,
  totalShardsProduced = tree.quantity,
  nodeId,
  expandedStates,
  onToggle,
  onShowAlternatives,
  noWoodenBait = false,
  ironManView,
  bazaarPrices,
  filterLowVolume,
  filterVolatile,
  suspiciousPriceShards,
  substitutedShards,
  minBuyVolume = STABLE_MIN_DAILY_BUY_VOLUME,
  minSellVolume = STABLE_MIN_DAILY_SELL_VOLUME,
}) => {
  const shard = data.shards[tree.shard];

  if (isTopLevel && substitutedShards && substitutedShards.size > 0) {
    console.log("[RecipeTreeNode] substitutedShards received:", substitutedShards.size, "entries", Object.fromEntries(substitutedShards));
  }

  // Helper function to get expansion state and ensure it's initialized
  const getExpansionState = (id: string, defaultState: boolean = true) => {
    if (!expandedStates.has(id)) {
      expandedStates.set(id, defaultState);
    }
    return expandedStates.get(id)!;
  };

  const isReptileRecipe = (recipe: Recipe | undefined, input1Shard: Shard | undefined, input2Shard: Shard | undefined): boolean => {
    return (recipe?.isReptile || input1Shard?.family?.toLowerCase().includes("reptile") || input2Shard?.family?.toLowerCase().includes("reptile")) as boolean;
  };

  const getCrocodileProcs = (tree: RecipeTree): number | null => {
    if (tree.method === "cycle") {
      const hasReptile = tree.steps.some((step) => {
        const recipe = step.recipe;
        const input1Shard = data.shards[recipe.inputs[0]];
        const input2Shard = data.shards[recipe.inputs[1]];
        return isReptileRecipe(recipe, input1Shard, input2Shard);
      });
      return hasReptile ? Math.ceil(tree.quantity / 2) : null;
    }
    if (tree.method === "recipe") {
      const recipe = tree.recipe;
      const input1Shard = data.shards[recipe.inputs[0]];
      const input2Shard = data.shards[recipe.inputs[1]];
      if (isReptileRecipe(recipe, input1Shard, input2Shard)) {
        const requiredOutputQuantity = tree.quantity;
        let inputQuantityOfReptile = 0;
        let inputFuseAmount = 0;
        if (input1Shard?.family?.toLowerCase().includes("reptile")) {
          inputQuantityOfReptile = tree.inputs[0].quantity;
          inputFuseAmount = input1Shard.fuse_amount;
        } else if (input2Shard?.family?.toLowerCase().includes("reptile")) {
          inputQuantityOfReptile = tree.inputs[1].quantity;
          inputFuseAmount = input2Shard.fuse_amount;
        }
        return Math.ceil(requiredOutputQuantity / tree.recipe.outputQuantity - inputQuantityOfReptile / inputFuseAmount);
      }
    }
    return null;
  };

  const isShardFiltered = (shardId: string): { filtered: boolean; reason: string } => {
    if (!bazaarPrices || ironManView) return { filtered: false, reason: "" };
    const priceInfo = bazaarPrices[shardId];
    // "Stable" = filtre volume : shards sous le seuil sont masquées
    if (filterLowVolume) {
      if (!priceInfo) {
        const hasRecipes = !!data.recipes[shardId]?.length;
        if (hasRecipes) return { filtered: false, reason: "" };
        return { filtered: true, reason: "no price" };
      }
      if (priceInfo.dailyBuyVolume < minBuyVolume || priceInfo.dailySellVolume < minSellVolume) {
        return { filtered: true, reason: "volume" };
      }
    }
    // "Safe" = ne masque PAS (juste un warning)
    return { filtered: false, reason: "" };
  };

  const isShardSuspicious = (shardId: string): boolean => {
    return !!filterVolatile && !!suspiciousPriceShards?.has(shardId);
  };

  const getSubstitutionInfo = (shardId: string): { originalShardId: string; originalShard: Shard | undefined } | null => {
    if (!substitutedShards) return null;
    const originalId = substitutedShards.get(shardId);
    if (!originalId) return null;
    return { originalShardId: originalId, originalShard: data.shards[originalId] };
  };

  const renderChevron = (isExpanded: boolean) => (isExpanded ? <ChevronDown className="w-4 h-4 text-amber-400" /> : <ChevronRight className="w-4 h-4 text-amber-400" />);

  const renderShardInfo = (quantity: number, shard: Shard, showRate = true) => {
    const shardDesc = SHARD_DESCRIPTIONS[shard.id as keyof typeof SHARD_DESCRIPTIONS];
    return (
      <>
        <span className="text-white">{quantity}x</span>
        <Tooltip
          content={formatShardDescription(shardDesc?.description || "No description available.")}
          title={shardDesc?.title}
          shardName={shard.name}
          shardIcon={shard.id}
          rarity={shard.rarity}
          family={shard.family}
          type={shard.type}
          shardId={shard.id}
          className="cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}shardIcons/${shard.id}.png`} alt={shard.name} className="w-5 h-5 object-contain flex-shrink-0" loading="lazy" />
            <span className={getRarityColor(shard.rarity)}>{shard.name}</span>
            {/* "Stable" warning: low volume */}
            {filterLowVolume && !ironManView && bazaarPrices?.[shard.id] && (
              (bazaarPrices[shard.id].dailyBuyVolume < minBuyVolume || bazaarPrices[shard.id].dailySellVolume < minSellVolume) && (
                <span title="Volume faible (< 5k achat ou < 5k vente)"><AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" /></span>
              )
            )}
            {/* "Safe" warning: price anomaly */}
            {isShardSuspicious(shard.id) && (
              <span title="Prix actuel ~30% sous la moyenne 24h — vérifier avant d'acheter/vendre"><AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" /></span>
            )}
          </div>
        </Tooltip>
        {showRate && (
          <div className="text-right min-w-[80px] ml-2">
            {ironManView && (
              <>
                <span className="text-slate-300 text-xs font-medium">{formatNumber(shard.rate)}</span>
                <span className="text-slate-500 text-xs mx-0.5">/</span>
                <span className="text-slate-400 text-xs">hr</span>
              </>
            )}
            {!ironManView && (
              <>
                <span className="text-slate-300 text-xs font-medium">
                  {bazaarPrices?.[shard.id]?.dailyBuyVolume
                    ? formatLargeNumber(bazaarPrices[shard.id].dailyBuyVolume / 24)
                    : formatLargeNumber(quantity * shard.rate)}
                </span>
              </>
            )}
          </div>
        )}
      </>
    );
  };

  const renderRecipeDisplay = (
    outputQuantity: number,
    outputShard: Shard,
    input1Quantity: number,
    input1Shard: Shard,
    input2Quantity: number,
    input2Shard: Shard,
    showStep = false,
    stepNumber?: number
  ) => {
    const outputShardDesc = SHARD_DESCRIPTIONS[outputShard.id as keyof typeof SHARD_DESCRIPTIONS];
    const input1ShardDesc = SHARD_DESCRIPTIONS[input1Shard.id as keyof typeof SHARD_DESCRIPTIONS];
    const input2ShardDesc = SHARD_DESCRIPTIONS[input2Shard.id as keyof typeof SHARD_DESCRIPTIONS];
    const input1Substituted = substitutedShards?.has(input1Shard.id);
    const input2Substituted = substitutedShards?.has(input2Shard.id);

    return (
      <div className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
        {showStep && <span className="font-normal text-xs text-amber-300">Step {stepNumber} :</span>}

        <span className="text-white">{outputQuantity}x</span>
        <Tooltip
          content={formatShardDescription(outputShardDesc?.description || "No description available.")}
          title={outputShardDesc?.title}
          shardName={outputShard.name}
          shardIcon={outputShard.id}
          rarity={outputShard.rarity}
          family={outputShard.family}
          type={outputShard.type}
          shardId={outputShard.id}
          className="cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}shardIcons/${outputShard.id}.png`} alt={outputShard.name} className="w-5 h-5 object-contain flex-shrink-0" loading="lazy" />
            <span className={getRarityColor(outputShard.rarity)}>{outputShard.name}</span>
          </div>
        </Tooltip>

        <span> = </span>

        <span className="text-slate-400">{input1Quantity}x</span>
        <Tooltip
          content={formatShardDescription(input1ShardDesc?.description || "No description available.")}
          title={input1ShardDesc?.title}
          shardName={input1Shard.name}
          shardIcon={input1Shard.id}
          rarity={input1Shard.rarity}
          family={input1Shard.family}
          type={input1Shard.type}
          shardId={input1Shard.id}
          className="cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}shardIcons/${input1Shard.id}.png`} alt={input1Shard.name} className={`w-5 h-5 object-contain flex-shrink-0 ${input1Substituted ? "ring-1 ring-purple-400/60 rounded" : ""}`} loading="lazy" />
            <span className={input1Substituted ? "text-purple-300 font-medium" : getRarityColor(input1Shard.rarity)}>{input1Shard.name}</span>
            {input1Substituted && <ArrowLeftRight className="w-3 h-3 text-purple-400 flex-shrink-0" />}
          </div>
        </Tooltip>

        <span> + </span>

        <span className="text-slate-400">{input2Quantity}x</span>
        <Tooltip
          content={formatShardDescription(input2ShardDesc?.description || "No description available.")}
          title={input2ShardDesc?.title || input2Shard.name}
          shardName={input2Shard.name}
          shardIcon={input2Shard.id}
          rarity={input2Shard.rarity}
          family={input2Shard.family}
          type={input2Shard.type}
          shardId={input2Shard.id}
          className="cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}shardIcons/${input2Shard.id}.png`} alt={input2Shard.name} className={`w-5 h-5 object-contain flex-shrink-0 ${input2Substituted ? "ring-1 ring-purple-400/60 rounded" : ""}`} loading="lazy" />
            <span className={input2Substituted ? "text-purple-300 font-medium" : getRarityColor(input2Shard.rarity)}>{input2Shard.name}</span>
            {input2Substituted && <ArrowLeftRight className="w-3 h-3 text-purple-400 flex-shrink-0" />}
          </div>
        </Tooltip>
      </div>
    );
  };

  const renderDirectShard = (quantity: number, shard: Shard) => {
    const { filtered, reason } = isShardFiltered(shard.id);
    const isFiltered = filtered && !ironManView;
    const suspicious = isShardSuspicious(shard.id);
    const substitution = getSubstitutionInfo(shard.id);
    const isSubstituted = !!substitution;
    return (
      <div className={`rounded border flex items-center justify-between px-3 py-1.5 text-sm font-medium gap-2 ${isSubstituted ? "border-purple-500/50 bg-purple-500/5" : isFiltered ? "border-red-700/50 opacity-60" : suspicious ? "border-red-500/30" : "border-slate-400/50"}`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full ${isSubstituted ? "bg-purple-400" : isFiltered ? "bg-red-400" : "bg-green-400"}`} />
          {isFiltered && !isSubstituted && <ShieldX className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
          {renderShardInfo(Math.ceil(quantity), shard, false)}
          <span className={`px-1 py-0.4 text-xs border rounded-md flex-shrink-0 ${isSubstituted ? "bg-purple-500/20 text-purple-300 border-purple-500/30" : isFiltered ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-green-500/20 text-green-400 border-green-500/30"}`}>{ironManView ? "Direct" : "Bazaar"}</span>
          {isFiltered && !isSubstituted && (
            <span className="text-[10px] text-red-400 whitespace-nowrap">
              {reason === "no price" ? "No price" : "Low volume"}
            </span>
          )}
          {substitution && (
            <Tooltip
              content={`Substituted for <span class="text-purple-300">${substitution.originalShard?.name ?? substitution.originalShardId}</span>`}
              title="Shard Substitution"
              shardName={substitution.originalShard?.name}
              shardIcon={substitution.originalShardId}
              rarity={substitution.originalShard?.rarity}
              className="cursor-help"
              showRomanNumerals={false}
            >
              <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded whitespace-nowrap">
                <ArrowLeftRight className="w-3 h-3" />
                Replaced
              </span>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right min-w-[80px] ml-2">
            {ironManView && (
              <>
                <span className="text-slate-300 text-xs font-medium">{formatNumber(shard.rate)}</span>
                <span className="text-slate-500 text-xs mx-0.5">/</span>
                <span className="text-slate-400 text-xs">hr</span>
              </>
            )}
            {!ironManView && (
              <>
                <span className="text-slate-300 text-xs font-medium">
                  {bazaarPrices?.[shard.id]?.dailyBuyVolume
                    ? formatLargeNumber(bazaarPrices[shard.id].dailyBuyVolume / 24)
                    : formatLargeNumber(quantity * shard.rate)}
                </span>
              </>
            )}
          </div>
          {suspicious && onShowAlternatives && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onShowAlternatives(shard.id, {
                  currentRecipe: null,
                  requiredQuantity: quantity,
                });
              }}
              className="px-1.5 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/20 hover:border-red-500/30 rounded transition-colors cursor-pointer"
              title="Voir les alternatives sans cette shard"
            >
              Voir alternative
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderSubRecipe = (recipeTree: RecipeTree, inputShard: Shard, nodePrefix: string) => {
    if (recipeTree.method === "direct") return renderDirectShard(recipeTree.quantity, inputShard);
    if (recipeTree.method !== "recipe") return null;
    const input1Shard = data.shards[recipeTree.recipe.inputs[0]];
    const input2Shard = data.shards[recipeTree.recipe.inputs[1]];
    const input1Quantity = input1Shard.fuse_amount * recipeTree.craftsNeeded;
    const input2Quantity = input2Shard.fuse_amount * recipeTree.craftsNeeded;
    const subNodeId = `${nodePrefix}-${inputShard.id}`;
    const isExpanded = getExpansionState(subNodeId, true);

    return (
      <div className="rounded border border-slate-400/50 overflow-hidden">
        <div
          className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-slate-800/50 transition-colors cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(subNodeId);
          }}
        >
          <div className="flex-1 text-left">
            <div className="flex items-center space-x-2">
              {renderChevron(isExpanded)}
              {renderRecipeDisplay(recipeTree.quantity, inputShard, input1Quantity, input1Shard, input2Quantity, input2Shard)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right min-w-[80px] ml-2">
              <div className="flex items-center justify-end space-x-1.5">
                <span className="text-xs text-slate-500">fusions</span>
                <span className="font-medium text-white text-xs">{recipeTree.craftsNeeded}</span>
              </div>
            </div>
          </div>
        </div>
        {isExpanded && (
          <div className="border-t border-slate-400/70 pl-3 pr-0.5 py-0.5 flex flex-col gap-0.5">
            {recipeTree.inputs.map((subTree: RecipeTree) => {
              const directShard = data.shards[subTree.shard];
              if (!directShard || !recipeTree) return null;
              return <div key={`sub-${subTree.shard}`}>{renderSubRecipe(subTree, directShard, subNodeId)}</div>;
            })}
          </div>
        )}
      </div>
    );
  };

  if (tree.method === "cycle") {
    const isExpanded = getExpansionState(nodeId, true);
    const runCount = tree.craftsNeeded;
    const crocProcs = getCrocodileProcs(tree);

    return (
      <div className="flex flex-col border border-slate-400/50 rounded-md bg-slate-900">
        <div
          className="flex items-center justify-between w-full pl-3 pr-1 py-1 hover:bg-slate-800/50 transition-colors cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(nodeId);
          }}
        >
          <div className="flex-1 text-left">
            <div className="flex items-center space-x-2">
              {renderChevron(isExpanded)}
              <div className="flex items-center gap-3">
                <div className="text-xs text-amber-300">{runCount} crafts</div>
                <MoveRight className="w-4 text-amber-400" />
                <div className="flex items-center space-x-2 text-sm">
                  {renderShardInfo(Math.floor(tree.quantity), shard, false)}
                  <span className="px-1 py-0.4 text-xs bg-amber-500/20 text-amber-400 border border-amber-400/40 text-[11px] font-medium rounded-md">Cycle</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <div className="text-right">
              <div className="flex py-1 px-1.5 gap-1 items-center cursor-pointer">
                <span className="text-xs text-slate-400">fusions</span>
                <span className="font-medium text-slate-300 text-xs">{runCount}</span>
              </div>
            </div>
            {crocProcs !== null && (
              <Tooltip
                content={`Crocodile has a chance to double the output of reptile recipes. You need <span class="text-green-400">${crocProcs} Pure Reptile </span> triggers to have enough shards for the craft. This is based on average luck`}
                title={`Pure Reptile`}
                shardName="Crocodile"
                shardIcon="R45"
                rarity="rare"
                className="cursor-help"
                showRomanNumerals={false}
              >
                <div className="flex items-center gap-1 px-[5px] py-1 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded">
                  <span className="text-xs text-green-300 font-extralight">{crocProcs}</span>
                  <GeckoIcon className="w-3 h-3 text-green-400" />
                </div>
              </Tooltip>
            )}
            {onShowAlternatives && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Find the recipe that produces the target shard in the cycle
                  const step = tree.steps.find((step) => step.outputShard === tree.shard);
                  const targetRecipe = step?.recipe || null;
                  onShowAlternatives(tree.shard, {
                    currentRecipe: targetRecipe,
                    requiredQuantity: tree.quantity,
                  });
                }}
                className="p-1 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/20 hover:border-blue-500/30 rounded transition-colors cursor-pointer"
                title="Show alternatives"
              >
                <Settings className="w-4 h-4 text-blue-300 hover:text-blue-200" />
              </button>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className="border-t border-slate-400/50 pl-3 pr-0.5 py-0.5 space-y-0.5">
            <div className="">
              {[...tree.steps]
                .slice()
                .reverse()
                .map((step, stepIndex) => {
                  const recipe = step.recipe;
                  const outputShardData = data.shards[step.outputShard];
                  const input1Shard = data.shards[recipe.inputs[0]];
                  const input2Shard = data.shards[recipe.inputs[1]];
                  const input1Quantity = input1Shard.fuse_amount;
                  const input2Quantity = input2Shard.fuse_amount;
                  let outputQuantity = recipe.outputQuantity;
                  if (recipe.isReptile) outputQuantity *= tree.multiplier;
                  const stepNumber = tree.steps.length - stepIndex;

                  if (stepNumber === 1) {
                    const stepNodeId = `${nodeId}-step-${stepNumber}`;
                    const stepIsExpanded = getExpansionState(stepNodeId, true);

                    return (
                      <div key={stepIndex} className="rounded border border-slate-400/50 overflow-hidden">
                        <div
                          className="flex items-center justify-between w-full pl-3 pr-1 py-1 hover:bg-slate-800/50 transition-colors cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggle(stepNodeId);
                          }}
                        >
                          <div className="flex-1 text-left">
                            <div className="flex items-center space-x-2">
                              {renderChevron(stepIsExpanded)}
                              {renderRecipeDisplay(outputQuantity, outputShardData, input1Quantity, input1Shard, input2Quantity, input2Shard, true, stepNumber)}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {onShowAlternatives && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onShowAlternatives(step.outputShard, {
                                    currentRecipe: recipe,
                                    requiredQuantity: tree.craftsNeeded * outputQuantity,
                                  });
                                }}
                                className="p-1 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/20 hover:border-blue-500/30 rounded transition-colors cursor-pointer"
                                title="Show alternatives"
                              >
                                <Settings className="w-4 h-4 text-blue-300 hover:text-blue-200" />
                              </button>
                            )}
                          </div>
                        </div>
                        {stepIsExpanded && (
                          <div className="border-t border-slate-400/50 pl-3 pr-0.5 py-0.5 space-y-1">
                            <div key={tree.inputRecipe.shard} className="space-y-1">
                              {renderSubRecipe(tree.inputRecipe, data.shards[tree.inputRecipe.shard], stepNodeId)}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  } else {
                    return (
                      <div key={stepIndex} className="pl-3 pr-1 py-1 rounded border border-slate-400/50 flex items-center justify-between">
                        {renderRecipeDisplay(outputQuantity, outputShardData, input1Quantity, input1Shard, input2Quantity, input2Shard, true, stepNumber)}
                        <div className="flex items-center gap-2">
                          {onShowAlternatives && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onShowAlternatives(step.outputShard, {
                                  currentRecipe: recipe,
                                  requiredQuantity: tree.craftsNeeded * outputQuantity,
                                });
                              }}
                              className="p-1 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/20 hover:border-blue-500/30 rounded transition-colors cursor-pointer"
                              title="Show alternatives"
                            >
                              <Settings className="w-4 h-4 text-blue-300 hover:text-blue-200" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }
                })}
            </div>

            <div className="flex gap-1.5 py-1 pl-2">
              <div className="text-slate-400 text-xs border-l-1 border-slate-500 pl-1.5">Cycle Fodder</div>
            </div>

            {/* Cycle summary */}
            {(() => {
              return (
                <div className="flex flex-col gap-0.5 mt-0.5">
                  {Object.values(tree.cycleInputs).map((cycleTree) => {
                    const subNodeId = `${nodeId}-cycle-input`;
                    return <div key={cycleTree.shard}>{renderSubRecipe(cycleTree, data.shards[cycleTree.shard], subNodeId)}</div>;
                  })}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    );
  }

  if (tree.method === "direct") {
    const { filtered: isDirectFiltered, reason: directReason } = isShardFiltered(tree.shard);
    const showDirectFiltered = isDirectFiltered && !ironManView;
    const substitution = getSubstitutionInfo(tree.shard);
    const isSubstituted = !!substitution;
    return (
      <div className={`flex items-center justify-between pl-3.5 pr-1 py-1 bg-slate-800 rounded-md border ${isSubstituted ? "border-purple-500/50" : showDirectFiltered ? "border-red-700/50 opacity-60" : "border-slate-600"}`}>
        <div className="flex items-center space-x-2 p-0.5 text-sm">
          <div className={`w-2 h-2 rounded-full mr-2.5 ${isSubstituted ? "bg-purple-400" : showDirectFiltered ? "bg-red-400" : "bg-green-400"}`} />
          {showDirectFiltered && !isSubstituted && <ShieldX className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
          {renderShardInfo(tree.quantity, shard, false)}
          <span className={`px-1 py-0.4 text-xs border rounded-md flex-shrink-0 ${isSubstituted ? "bg-purple-500/20 text-purple-300 border-purple-500/30" : showDirectFiltered ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-green-500/20 text-green-400 border-green-500/30"}`}>{ironManView ? "Direct" : "Bazaar"}</span>
          {showDirectFiltered && !isSubstituted && (
            <span className="text-[10px] text-red-400 whitespace-nowrap">
              {directReason === "no price" ? "No price" : directReason === "suspicious" ? "Suspicious price" : "Low volume"}
            </span>
          )}
          {substitution && (
            <Tooltip
              content={`Substituted for <span class="text-purple-300">${substitution.originalShard?.name ?? substitution.originalShardId}</span>`}
              title="Shard Substitution"
              shardName={substitution.originalShard?.name}
              shardIcon={substitution.originalShardId}
              rarity={substitution.originalShard?.rarity}
              className="cursor-help"
              showRomanNumerals={false}
            >
              <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded whitespace-nowrap">
                <ArrowLeftRight className="w-3 h-3" />
                Replaced
              </span>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            {ironManView && (
              <div>
                <span className="text-slate-300 text-xs font-medium">{formatNumber(shard.rate)}</span>
                <span className="text-slate-500 text-xs mx-0.5">/</span>
                <span className="text-slate-400 text-xs">hr</span>
              </div>
            )}
            {!ironManView && (
              <div>
                <span className="text-slate-300 text-xs font-medium">
                  {bazaarPrices?.[shard.id]?.dailyBuyVolume
                    ? formatLargeNumber(bazaarPrices[shard.id].dailyBuyVolume / 24)
                    : formatLargeNumber(tree.quantity * shard.rate)}
                </span>
              </div>
            )}
          </div>
          {onShowAlternatives && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onShowAlternatives(tree.shard, {
                  currentRecipe: null,
                  requiredQuantity: tree.quantity,
                });
              }}
              className="p-1 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/20 hover:border-blue-500/30 rounded transition-colors cursor-pointer"
              title="Show alternatives"
            >
              <Settings className="w-4 h-4 text-blue-300 hover:text-blue-200" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // Recipe nodes
  const isExpanded = getExpansionState(nodeId, true);
  const input1 = tree.inputs![0];
  const input2 = tree.inputs![1];
  const input1Shard = data.shards[input1.shard];
  const input2Shard = data.shards[input2.shard];
  const crafts = "craftsNeeded" in tree ? tree.craftsNeeded ?? 1 : 1;
  const displayQuantity = isTopLevel ? totalShardsProduced : tree.quantity;
  const crocProcs = getCrocodileProcs(tree);

  const shardDesc = SHARD_DESCRIPTIONS[shard.id as keyof typeof SHARD_DESCRIPTIONS];
  const input1ShardDesc = SHARD_DESCRIPTIONS[input1Shard.id as keyof typeof SHARD_DESCRIPTIONS];
  const input2ShardDesc = SHARD_DESCRIPTIONS[input2Shard.id as keyof typeof SHARD_DESCRIPTIONS];

  return (
    <div className="bg-slate-800 border border-slate-600 rounded-md overflow-hidden">
      <div
        className="flex items-center justify-between w-full pl-3 pr-1 py-1 hover:bg-slate-700/30 transition-colors cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onToggle(nodeId);
        }}
      >
        <div className="flex-1 text-left">
          <div className="flex items-center space-x-1.5">
            {renderChevron(isExpanded)}
            <div className="text-white flex items-center">
              <span className="font-medium text-sm">{Math.floor(displayQuantity)}x</span>

              <Tooltip
                content={formatShardDescription(shardDesc?.description || "No description available.")}
                title={shardDesc?.title}
                shardName={shard.name}
                shardIcon={shard.id}
                rarity={shard.rarity}
                family={shard.family}
                type={shard.type}
                shardId={shard.id}
                className="cursor-pointer mx-2"
              >
                <div className="flex items-center gap-2">
                  <img src={`${import.meta.env.BASE_URL}shardIcons/${shard.id}.png`} alt={shard.name} className="w-5 h-5 object-contain inline-block align-middle flex-shrink-0" loading="lazy" />
                  <span className={`font-medium ${getRarityColor(shard.rarity)} text-sm whitespace-nowrap truncate`} style={{ maxWidth: "8rem" }} title={shard.name}>
                    {shard.name}
                  </span>
                </div>
              </Tooltip>

              <span className="text-slate-400 text-sm font-medium flex items-center">
                <span className="mr-2 text-white">=</span>
                <span>{Math.floor(input1.quantity)}x</span>

                <Tooltip
                  content={formatShardDescription(input1ShardDesc?.description || "No description available.")}
                  title={input1ShardDesc?.title}
                  shardName={input1Shard.name}
                  shardIcon={input1Shard.id}
                  rarity={input1Shard.rarity}
                  family={input1Shard.family}
                  type={input1Shard.type}
                  shardId={input1Shard.id}
                  className="cursor-pointer mx-2"
                >
                  <div className="flex items-center gap-2">
                    <img
                      src={`${import.meta.env.BASE_URL}shardIcons/${input1Shard.id}.png`}
                      alt={input1Shard.name}
                      className={`w-5 h-5 object-contain inline-block align-middle flex-shrink-0 ${substitutedShards?.has(input1Shard.id) ? "ring-1 ring-purple-400/60 rounded" : ""}`}
                      loading="lazy"
                    />
                    <span className={(substitutedShards?.has(input1Shard.id) ? "text-purple-300 font-medium" : getRarityColor(input1Shard.rarity)) + " whitespace-nowrap truncate"} style={{ maxWidth: "8rem" }}>
                      {input1Shard.name}
                    </span>
                    {substitutedShards?.has(input1Shard.id) && <ArrowLeftRight className="w-3 h-3 text-purple-400 flex-shrink-0" />}
                  </div>
                </Tooltip>

                <span className="mr-2 text-white">+</span>
                <span>{Math.floor(input2.quantity)}x</span>

                <Tooltip
                  content={formatShardDescription(input2ShardDesc?.description || "No description available.")}
                  title={input2ShardDesc?.title}
                  shardName={input2Shard.name}
                  shardIcon={input2Shard.id}
                  rarity={input2Shard.rarity}
                  family={input2Shard.family}
                  type={input2Shard.type}
                  shardId={input2Shard.id}
                  className="cursor-pointer mx-2"
                >
                  <div className="flex items-center gap-2">
                    <img
                      src={`${import.meta.env.BASE_URL}shardIcons/${input2Shard.id}.png`}
                      alt={input2Shard.name}
                      className={`w-5 h-5 object-contain inline-block align-middle flex-shrink-0 ${substitutedShards?.has(input2Shard.id) ? "ring-1 ring-purple-400/60 rounded" : ""}`}
                      loading="lazy"
                    />
                    <span className={(substitutedShards?.has(input2Shard.id) ? "text-purple-300 font-medium" : getRarityColor(input2Shard.rarity)) + " whitespace-nowrap truncate"} style={{ maxWidth: "8rem" }}>
                      {input2Shard.name}
                    </span>
                    {substitutedShards?.has(input2Shard.id) && <ArrowLeftRight className="w-3 h-3 text-purple-400 flex-shrink-0" />}
                  </div>
                </Tooltip>
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="text-right">
            <div className="flex py-1 px-1.5 gap-1 items-center cursor-pointer">
              <span className="text-xs text-slate-400">fusions</span>
              <span className="font-medium text-slate-300 text-xs">{crafts}</span>
            </div>
          </div>
          {!ironManView && bazaarPrices?.[shard.id]?.dailySellVolume != null && (
            <div className="text-right">
              <div className="flex py-1 px-1.5 gap-1 items-center">
                <span className="text-xs text-slate-400">sell/h</span>
                <span className="font-medium text-slate-300 text-xs">{formatLargeNumber(bazaarPrices[shard.id].dailySellVolume / 24)}</span>
              </div>
            </div>
          )}
          {crocProcs !== null && (
            <Tooltip
              content={`Crocodile has a chance to double the output of reptile recipes. You need <span class="text-green-400">${crocProcs} Pure Reptile </span> triggers to have enough shards for the craft. This is based on average luck`}
              title={`Pure Reptile`}
              shardName="Crocodile"
              shardIcon="R45"
              rarity="rare"
              className="cursor-help"
              showRomanNumerals={false}
            >
              <div className="flex items-center gap-1 px-[5px] py-1 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded">
                <span className="text-xs text-green-300 font-extralight">{crocProcs}</span>
                <GeckoIcon className="w-3 h-3 text-green-400" />
              </div>
            </Tooltip>
          )}
          {onShowAlternatives && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onShowAlternatives(tree.shard, {
                  currentRecipe: "recipe" in tree ? tree.recipe : null,
                  requiredQuantity: tree.quantity,
                });
              }}
              className="p-1 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/20 hover:border-blue-500/30 rounded transition-colors cursor-pointer"
              title="Show alternatives"
            >
              <Settings className="w-4 h-4 text-blue-300 hover:text-blue-200" />
            </button>
          )}
        </div>
      </div>
      {isExpanded && (
        <div className="border-t border-slate-600 pl-3 pr-0.5 py-0.5 space-y-0.5">
          <RecipeTreeNode
            tree={input1}
            data={data}
            nodeId={`${nodeId}-0`}
            expandedStates={expandedStates}
            onToggle={onToggle}
            onShowAlternatives={onShowAlternatives}
            noWoodenBait={noWoodenBait}
            ironManView={ironManView}
            bazaarPrices={bazaarPrices}
            filterLowVolume={filterLowVolume}
            filterVolatile={filterVolatile}
            suspiciousPriceShards={suspiciousPriceShards}
            substitutedShards={substitutedShards}
            minBuyVolume={minBuyVolume}
            minSellVolume={minSellVolume}
          />
          <RecipeTreeNode
            tree={input2}
            data={data}
            nodeId={`${nodeId}-1`}
            expandedStates={expandedStates}
            onToggle={onToggle}
            onShowAlternatives={onShowAlternatives}
            noWoodenBait={noWoodenBait}
            ironManView={ironManView}
            bazaarPrices={bazaarPrices}
            filterLowVolume={filterLowVolume}
            filterVolatile={filterVolatile}
            suspiciousPriceShards={suspiciousPriceShards}
            substitutedShards={substitutedShards}
            minBuyVolume={minBuyVolume}
            minSellVolume={minSellVolume}
          />
        </div>
      )}
    </div>
  );
};
