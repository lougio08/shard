import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Star, BookOpen } from "lucide-react";

interface WelcomeProfileModalProps {
  open: boolean;
  onSelectProfile: (profile: "ironman" | "normal") => void;
  onClose: () => void;
}

const GUIDE_URL = "/guide";

export const WelcomeProfileModal: React.FC<WelcomeProfileModalProps> = ({ open, onSelectProfile, onClose }) => {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "unset";
      };
    }
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="glass rounded-3xl shadow-2xl max-w-md w-full overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-white/10 bg-slate-800/50 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Star className="w-5 h-5 text-[#83b5d1]" />
              <h2 className="text-lg font-semibold text-white">Choose Profile</h2>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full transition-colors cursor-pointer" aria-label="Close">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 min-h-0">
          <div className="mb-4">
            <h3 className="text-base font-medium text-white">Welcome to SkyShards</h3>
            <p className="text-slate-300 mt-1">Pick the profile type you play. You can change this later</p>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => onSelectProfile("ironman")}
              className="w-full p-3 rounded-2xl border text-left transition-all duration-200 glass glass-hover"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white font-medium">Ironman</div>
                  <div className="text-xs text-slate-400">Self-sufficient progression</div>
                </div>
                <span className="px-1 py-0.5 text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full">No Bazaar</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onSelectProfile("normal")}
              className="w-full p-3 rounded-2xl border text-left transition-all duration-200 glass glass-hover"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white font-medium">Normal</div>
                  <div className="text-xs text-slate-400">Bazaar trading allowed</div>
                </div>
                <span className="px-1 py-0.5 text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded-full">Bazaar</span>
              </div>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-slate-800/50 flex-shrink-0">
          <div className="flex items-center justify-between gap-3 text-sm">
            <a
              href={GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#83b5d1] hover:bg-[#b9d6e8] text-black font-semibold border border-[#83b5d1] focus:outline-none focus:ring-2 focus:ring-[#83b5d1]/50 transition-colors duration-150"
            >
              <BookOpen className="w-4 h-4" />
              Read the Guide
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
