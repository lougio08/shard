import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Calculator, Settings, Shuffle, TrendingUp, BookOpen, Info, Mail } from "lucide-react";

const MAIN_ITEMS = [
  { path: "/", label: "CALCULATOR", icon: Calculator },
  { path: "/recipes", label: "RECIPES", icon: Shuffle },
  { path: "/profitability", label: "PROFIT", icon: TrendingUp },
  { path: "/shards", label: "SHARDS", icon: Settings },
];

const SECONDARY_ITEMS = [
  { path: "/guide", label: "GUIDE", icon: BookOpen },
  { path: "/about", label: "ABOUT", icon: Info },
  { path: "/contact", label: "CONTACT", icon: Mail },
];

export const SiteNavigationPanel: React.FC = () => {
  const location = useLocation();
  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <div className="glass h-full">
      <div className="title-bar px-3 py-1.5 mono-label text-[#83b5d1]/70">+--- NAVIGATE ---+</div>
      <div className="p-3 space-y-3">
        <nav className="flex flex-col gap-1">
          {MAIN_ITEMS.map(({ path, label, icon: Icon }) => {
            const active = isActive(path);
            return (
              <Link
                key={path}
                to={path}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors duration-150 cursor-pointer ${
                  active
                    ? "bg-[#83b5d1] text-black"
                    : "text-[#83b5d1]/70 hover:text-[#83b5d1] hover:bg-[#83b5d1]/10"
                }`}
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={2} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-[#726e97] pt-2 flex flex-col gap-1">
          {SECONDARY_ITEMS.map(({ path, label, icon: Icon }) => {
            const active = isActive(path);
            return (
              <Link
                key={path}
                to={path}
                className={`flex items-center gap-2 px-2 py-1.5 text-sm transition-colors duration-150 cursor-pointer ${
                  active
                    ? "bg-[#83b5d1] text-black"
                    : "text-[#83b5d1]/70 hover:text-[#83b5d1] hover:bg-[#83b5d1]/10"
                }`}
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={2} />
                <span>&gt; {label.toLowerCase()}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
};
