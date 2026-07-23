import type { Data } from "../types/types";
import { MAX_QUANTITIES } from "../constants";

export type FusionEdgeType = "special" | "id";

export interface FusionGraph {
  special: Map<string, Set<string>>;
  id: Map<string, Set<string>>;
  specialRev: Map<string, Set<string>>;
  idRev: Map<string, Set<string>>;
}

export interface BuildFusionGraphOptions {
  dominanceThreshold?: number;
  minCount?: number;
  isDirectlyObtainable?: (id: string) => boolean;
  minCost?: (id: string) => number;
}

const DEFAULT_DOMINANCE_THRESHOLD = 0.2;
const DEFAULT_MIN_COUNT = 2;
const CHAMELEON_ID = "L4";

const addEdge = (
  fwd: Map<string, Set<string>>,
  rev: Map<string, Set<string>>,
  from: string,
  to: string
) => {
  let f = fwd.get(from);
  if (!f) {
    f = new Set();
    fwd.set(from, f);
  }
  f.add(to);
  let r = rev.get(to);
  if (!r) {
    r = new Set();
    rev.set(to, r);
  }
  r.add(from);
};

type Recipe = Data["recipes"][string][number];

export function buildFusionGraph(
  data: Data,
  opts: BuildFusionGraphOptions = {}
): FusionGraph {
  const threshold = opts.dominanceThreshold ?? DEFAULT_DOMINANCE_THRESHOLD;
  const minCount = opts.minCount ?? DEFAULT_MIN_COUNT;

  const graph: FusionGraph = {
    special: new Map(),
    id: new Map(),
    specialRev: new Map(),
    idRev: new Map(),
  };

  for (const output of Object.keys(data.recipes)) {
    const byQuantity = new Map<number, Recipe[]>();
    for (const recipe of data.recipes[output]) {
      const list = byQuantity.get(recipe.outputQuantity);
      if (list) list.push(recipe);
      else byQuantity.set(recipe.outputQuantity, [recipe]);
    }

    for (const [quantity, recipes] of byQuantity) {
      const usable = recipes.filter(
        (r) => r.inputs[0] !== CHAMELEON_ID && r.inputs[1] !== CHAMELEON_ID
      );
      if (usable.length === 0) continue;

      const counts = new Map<string, number>();
      for (const recipe of usable) {
        for (const input of recipe.inputs) {
          counts.set(input, (counts.get(input) ?? 0) + 1);
        }
      }

      const type: FusionEdgeType = quantity === 2 ? "special" : "id";
      const fwd = type === "special" ? graph.special : graph.id;
      const rev = type === "special" ? graph.specialRev : graph.idRev;

      for (const [input, count] of counts) {
        if (input === output) continue;
        if (count < minCount) continue;
        if (count / usable.length < threshold) continue;
        addEdge(fwd, rev, input, output);
      }
    }
  }

  if (opts.minCost) pruneHigherCostEdges(graph, opts.minCost);
  if (opts.isDirectlyObtainable) pruneUnobtainableRoots(graph, opts.isDirectlyObtainable);

  return graph;
}

const removeEdge = (
  fwd: Map<string, Set<string>>,
  rev: Map<string, Set<string>>,
  from: string,
  to: string
) => {
  const f = fwd.get(from);
  if (f) {
    f.delete(to);
    if (f.size === 0) fwd.delete(from);
  }
  const r = rev.get(to);
  if (r) {
    r.delete(from);
    if (r.size === 0) rev.delete(to);
  }
};

const canReach = (
  fwd: Map<string, Set<string>>,
  start: string,
  goal: string
): boolean => {
  const visited = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === goal) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const next of fwd.get(node) ?? []) stack.push(next);
  }
  return false;
};

const pruneBackwardEdges = (
  fwd: Map<string, Set<string>>,
  rev: Map<string, Set<string>>,
  minCost: (id: string) => number,
  allow: (from: string, to: string) => boolean
) => {
  const doomed: [string, string][] = [];
  for (const [from, tos] of fwd) {
    const cf = minCost(from);
    for (const to of tos) {
      if (cf > minCost(to) && allow(from, to)) doomed.push([from, to]);
    }
  }
  for (const [from, to] of doomed) removeEdge(fwd, rev, from, to);
};

function pruneHigherCostEdges(
  graph: FusionGraph,
  minCost: (id: string) => number
): void {
  pruneBackwardEdges(graph.id, graph.idRev, minCost, () => true);
  pruneBackwardEdges(
    graph.special,
    graph.specialRev,
    minCost,
    (from, to) => canReach(graph.special, to, from)
  );
}

const removeFrom = (
  fwd: Map<string, Set<string>>,
  rev: Map<string, Set<string>>,
  from: string
) => {
  const tos = fwd.get(from);
  if (!tos) return;
  for (const to of tos) {
    const r = rev.get(to);
    if (r) {
      r.delete(from);
      if (r.size === 0) rev.delete(to);
    }
  }
  fwd.delete(from);
};

function pruneUnobtainableRoots(
  graph: FusionGraph,
  isDirectlyObtainable: (id: string) => boolean
): void {
  for (;;) {
    const dead: string[] = [];
    const candidates = new Set<string>([
      ...graph.special.keys(),
      ...graph.id.keys(),
    ]);
    for (const id of candidates) {
      const hasOut =
        (graph.special.get(id)?.size ?? 0) > 0 ||
        (graph.id.get(id)?.size ?? 0) > 0;
      const hasIn =
        (graph.specialRev.get(id)?.size ?? 0) > 0 ||
        (graph.idRev.get(id)?.size ?? 0) > 0;
      if (hasOut && !hasIn && !isDirectlyObtainable(id)) dead.push(id);
    }
    if (dead.length === 0) break;
    for (const id of dead) {
      removeFrom(graph.special, graph.specialRev, id);
      removeFrom(graph.id, graph.idRev, id);
    }
  }
}

export function getSpecialDownstreamClosure(
  shardId: string,
  graph: FusionGraph,
  memo?: Map<string, Set<string>>
): Set<string> {
  if (memo?.has(shardId)) return memo.get(shardId)!;

  const closure = new Set<string>([shardId]);
  const stack = [...(graph.special.get(shardId) ?? [])];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (closure.has(node)) continue;
    closure.add(node);
    for (const next of graph.special.get(node) ?? []) {
      if (!closure.has(next)) stack.push(next);
    }
  }

  memo?.set(shardId, closure);
  return closure;
}

export function computeFreelyUsableShards(
  data: Data,
  ownedAttributes: Map<string, number>,
  isDirectlyObtainable?: (id: string) => boolean,
  minCost?: (id: string) => number
): Set<string> {
  if (ownedAttributes.size === 0) return new Set();

  const graph = buildFusionGraph(data, { isDirectlyObtainable, minCost });
  const memo = new Map<string, Set<string>>();

  const isMaxed = (id: string): boolean => {
    const shard = data.shards[id];
    if (!shard) return false;
    const cap =
      MAX_QUANTITIES[shard.rarity.toLowerCase() as keyof typeof MAX_QUANTITIES] ??
      MAX_QUANTITIES.common;
    return (ownedAttributes.get(id) ?? 0) >= cap;
  };

  const result = new Set<string>();
  for (const id of Object.keys(data.shards)) {
    const closure = getSpecialDownstreamClosure(id, graph, memo);
    let allMaxed = true;
    for (const member of closure) {
      if (!isMaxed(member)) {
        allMaxed = false;
        break;
      }
    }
    if (allMaxed) result.add(id);
  }

  return result;
}

export interface FusionTreeNode {
  id: string;
  name: string;
  rarity: Data["shards"][string]["rarity"];
  edgeType?: FusionEdgeType;
  sharedParents?: boolean;
  ref?: boolean;
  children: FusionTreeNode[];
}

export interface FusionLines {
  specialTrees: FusionTreeNode[];
  idLadders: FusionTreeNode[];
}

const makeNode = (
  data: Data,
  id: string,
  edgeType: FusionEdgeType | undefined,
  sharedParents: boolean,
  ref: boolean
): FusionTreeNode => ({
  id,
  name: data.shards[id]?.name ?? id,
  rarity: data.shards[id]?.rarity ?? "common",
  ...(edgeType ? { edgeType } : {}),
  ...(sharedParents ? { sharedParents: true } : {}),
  ...(ref ? { ref: true } : {}),
  children: [],
});

function buildTrees(
  data: Data,
  fwd: Map<string, Set<string>>,
  rev: Map<string, Set<string>>,
  type: FusionEdgeType
): FusionTreeNode[] {
  const nodes = new Set<string>([...fwd.keys(), ...rev.keys()]);
  const roots = [...nodes]
    .filter((id) => (fwd.get(id)?.size ?? 0) > 0 && (rev.get(id)?.size ?? 0) === 0)
    .sort();
  const expanded = new Set<string>();

  const expand = (id: string, edgeType: FusionEdgeType | undefined): FusionTreeNode => {
    const shared = (rev.get(id)?.size ?? 0) > 1;
    if (expanded.has(id)) return makeNode(data, id, edgeType, shared, true);
    expanded.add(id);
    const node = makeNode(data, id, edgeType, shared, false);
    for (const child of [...(fwd.get(id) ?? [])].sort()) {
      node.children.push(expand(child, type));
    }
    return node;
  };

  return roots.map((root) => expand(root, undefined));
}

export function computeFusionLines(
  data: Data,
  opts?: BuildFusionGraphOptions
): FusionLines {
  const graph = buildFusionGraph(data, opts);
  return {
    specialTrees: buildTrees(data, graph.special, graph.specialRev, "special"),
    idLadders: buildTrees(data, graph.id, graph.idRev, "id"),
  };
}