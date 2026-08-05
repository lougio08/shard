import { useCallback, useEffect, useState } from "react";
import { loadStableThresholds, saveStableThresholds, type StableThresholds } from "../utilities/stableThresholds";
import { DEFAULT_MIN_DAILY_BUY_VOLUME, DEFAULT_MIN_DAILY_SELL_VOLUME } from "../utilities/stableFilter";

const STABLE_THRESHOLDS_KEY = "skyshards_stable_thresholds";

export { DEFAULT_MIN_DAILY_BUY_VOLUME, DEFAULT_MIN_DAILY_SELL_VOLUME };

export function useStableThresholds() {
  const [thresholds, setThresholds] = useState<StableThresholds>(loadStableThresholds);

  useEffect(() => {
    saveStableThresholds(thresholds);
  }, [thresholds]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STABLE_THRESHOLDS_KEY && e.newValue) {
        try {
          setThresholds(JSON.parse(e.newValue));
        } catch {
          // ignore invalid storage content
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setMinBuyVolume = useCallback(
    (v: number) => setThresholds((t) => ({ ...t, minBuyVolume: Math.max(0, v || 0) })),
    []
  );
  const setMinSellVolume = useCallback(
    (v: number) => setThresholds((t) => ({ ...t, minSellVolume: Math.max(0, v || 0) })),
    []
  );

  return {
    minBuyVolume: thresholds.minBuyVolume,
    minSellVolume: thresholds.minSellVolume,
    setMinBuyVolume,
    setMinSellVolume,
  };
}
