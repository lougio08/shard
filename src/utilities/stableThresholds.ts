import { DEFAULT_MIN_DAILY_BUY_VOLUME, DEFAULT_MIN_DAILY_SELL_VOLUME } from "./stableFilter";

const STABLE_THRESHOLDS_KEY = "skyshards_stable_thresholds";

export interface StableThresholds {
  minBuyVolume: number;
  minSellVolume: number;
}

export function loadStableThresholds(): StableThresholds {
  try {
    const raw = localStorage.getItem(STABLE_THRESHOLDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        minBuyVolume: typeof parsed.minBuyVolume === "number" ? parsed.minBuyVolume : DEFAULT_MIN_DAILY_BUY_VOLUME,
        minSellVolume: typeof parsed.minSellVolume === "number" ? parsed.minSellVolume : DEFAULT_MIN_DAILY_SELL_VOLUME,
      };
    }
  } catch {
    // ignore invalid/absent storage
  }
  return { minBuyVolume: DEFAULT_MIN_DAILY_BUY_VOLUME, minSellVolume: DEFAULT_MIN_DAILY_SELL_VOLUME };
}

export function saveStableThresholds(thresholds: StableThresholds): void {
  try {
    localStorage.setItem(STABLE_THRESHOLDS_KEY, JSON.stringify(thresholds));
  } catch {
    // ignore storage failures (e.g. private mode)
  }
}
