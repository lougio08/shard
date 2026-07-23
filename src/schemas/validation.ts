export interface CalculationFormData {
  shard: string;
  quantity: number;
  hunterFortune: number;
  excludeChameleon: boolean;
  frogBonus: boolean;
  newtLevel: number;
  salamanderLevel: number;
  lizardKingLevel: number;
  leviathanLevel: number;
  pythonLevel: number;
  kingCobraLevel: number;
  seaSerpentLevel: number;
  tiamatLevel: number;
  crocodileLevel: number;
  kuudraTier: "none" | "t1" | "t2" | "t3" | "t4" | "t5";
  moneyPerHour: number | null;
  customKuudraTime: boolean;
  kuudraTimeSeconds: number | null;
  noWoodenBait: boolean;
  ironManView: boolean;
  instantBuyPrices: boolean;
  craftPenalty: number;
  materialsOnly: boolean;
  selectedShardKeys?: string[];
  shardQuantities?: Array<{ shard: import("../types/types").ShardWithKey; quantity: number }>;
}
