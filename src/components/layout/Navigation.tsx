import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Calculator, Settings, Shuffle, TrendingUp, Menu, X } from "lucide-react";

export const Navigation: React.FC = () => {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navItems = [
    { path: "/", label: "CALCULATOR", icon: Calculator },
    { path: "/recipes", label: "RECIPES", icon: Shuffle },
    { path: "/profitability", label: "PROFIT", icon: TrendingUp },
    { path: "/shards", label: "SHARDS", icon: Settings },
  ];

  // On the calculator page the site menu lives in the NAVIGATE panel next to TARGET
  const isCalculatorPage = location.pathname === "/";

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <header className="relative border-b border-[#726e97]">
      {/* Boot status bar */}
      <div className="px-4 sm:px-6 py-1.5 flex items-center justify-between mono-label text-[#83b5d1]/60 border-b border-[#726e97]/60 bg-[#0d130d]">
        <span>SKYSHARDS://TERMINAL</span>
        <span className="hidden sm:inline">
          BUILD:2.0 — STATUS:<span className="text-[#83b5d1]">[OK]</span>
          <span className="animate-blink ml-1.5">█</span>
        </span>
      </div>

      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 group cursor-pointer">
            <span className="bg-[#83b5d1] text-black font-bold px-2 py-1 text-lg leading-none group-hover:bg-white group-hover:text-black transition-colors duration-150">
              SKYSHARDS
            </span>
            <span className="animate-blink text-[#83b5d1] text-xl leading-none">█</span>
          </Link>

          {/* Window-style links */}
          {!isCalculatorPage && (
            <nav className="hidden lg:flex items-center gap-1">
              {navItems.map(({ path, label, icon: Icon }) => {
                const active = isActive(path);
                return (
                  <Link
                    key={path}
                    to={path}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors duration-150 cursor-pointer ${
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
          )}

          {/* Actions */}
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/Campionnn/SkyShards"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-2 px-4 py-1.5 border border-[#83b5d1]/60 text-[#83b5d1] text-xs font-bold mono-label hover:bg-[#83b5d1] hover:text-black hover:border-[#83b5d1] transition-colors duration-150 cursor-pointer"
            >
              [ GITHUB ]
            </a>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="lg:hidden p-2 border border-[#726e97] text-[#83b5d1]/70 hover:text-[#83b5d1] hover:bg-[#83b5d1]/10 transition-colors duration-150 cursor-pointer"
              aria-label="Toggle mobile menu"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {isMobileMenuOpen && (
        <div className="lg:hidden border-t border-[#726e97] bg-[#0a0a0a]">
          <div className="max-w-screen-2xl mx-auto px-4 py-3 flex flex-col gap-1">
            <p className="mono-label text-[#7698b3] mb-2"># MENU</p>
            {!isCalculatorPage && navItems.map(({ path, label, icon: Icon }) => {
              const active = isActive(path);
              return (
                <Link
                  key={path}
                  to={path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`px-3 py-2 text-sm flex items-center gap-2 transition-colors duration-150 cursor-pointer ${
                    active ? "bg-[#83b5d1] text-black font-semibold" : "text-[#83b5d1]/70 hover:text-[#83b5d1] hover:bg-[#83b5d1]/10"
                  }`}
                >
                  <Icon className="w-4 h-4" strokeWidth={2} />
                  <span>&gt; {label.toLowerCase()}</span>
                </Link>
              );
            })}
            <div className="border-t border-[#726e97] mt-2 pt-2 flex flex-col gap-1">
              {[
                { href: "https://greenhouse.skyshards.com", label: "> greenhouse" },
                { href: "https://github.com/Campionnn/SkyShards", label: "> github" },
                { href: "https://ko-fi.com/skyshards", label: "> buy_us_a_coffee" },
              ].map(({ href, label }) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="px-3 py-2 text-sm text-[#83b5d1]/70 hover:text-[#83b5d1] hover:bg-[#83b5d1]/10 transition-colors duration-150"
                >
                  {label}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
