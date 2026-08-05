import React from "react";

interface StableThresholdInputsProps {
  minBuyVolume: number;
  minSellVolume: number;
  onMinBuyVolumeChange: (v: number) => void;
  onMinSellVolumeChange: (v: number) => void;
}

export const StableThresholdInputs: React.FC<StableThresholdInputsProps> = ({
  minBuyVolume,
  minSellVolume,
  onMinBuyVolumeChange,
  onMinSellVolumeChange,
}) => (
  <div className="flex items-center gap-3 text-xs">
    <label className="flex items-center gap-1 text-slate-400">
      Min achat/jour
      <input
        type="number"
        min={0}
        step={100}
        value={minBuyVolume}
        onChange={(e) => onMinBuyVolumeChange(Number(e.target.value))}
        className="w-20 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200"
      />
    </label>
    <label className="flex items-center gap-1 text-slate-400">
      Min vente/jour
      <input
        type="number"
        min={0}
        step={100}
        value={minSellVolume}
        onChange={(e) => onMinSellVolumeChange(Number(e.target.value))}
        className="w-20 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200"
      />
    </label>
  </div>
);
