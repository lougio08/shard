import React, { useState, useEffect } from "react";
import { Outlet, useLocation, Link } from "react-router-dom";
import { Navigation } from "./Navigation";
import { ErrorBoundary } from "./ErrorBoundary";
import { PnPageAutoScale } from "../PnPageAutoScale";
import { GreenhouseModal } from "../modals";

const GREENHOUSE_MODAL_SEEN_KEY = "greenhouse_modal_seen";

const SHARD_ASCII = [
  "      \u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584",
  "     \u2588         \u2588",
  "    \u2588           \u2588",
  "   \u2588             \u2588",
  "  \u2588               \u2588",
  " \u2588                 \u2588",
  "\u2588                   \u2588",
  "\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580",
].join("\n");

export const Layout: React.FC = () => {
  const location = useLocation();
  const [showGreenhouseModal, setShowGreenhouseModal] = useState(false);

  useEffect(() => {
    // Check if user has seen the modal before
    const hasSeenModal = localStorage.getItem(GREENHOUSE_MODAL_SEEN_KEY);
    if (!hasSeenModal) {
      setShowGreenhouseModal(true);
    }
  }, []);

  const handleCloseGreenhouseModal = () => {
    // Mark modal as seen in localStorage
    localStorage.setItem(GREENHOUSE_MODAL_SEEN_KEY, "true");
    setShowGreenhouseModal(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Terminal shell */}
      <div className="relative max-w-[1600px] mx-auto px-2 sm:px-4 lg:px-6 py-4 sm:py-6">
        <div className="relative border border-[#726e97] bg-[#0a0a0a]">
          <div className="relative z-0">
            <Navigation />
            <main className="px-1 sm:px-2 lg:px-4 py-3">
              <div className="w-full">
                <div className="pn-page">
                  <div className="pn-left" aria-hidden />
                  <div className="pn-content">
                    <PnPageAutoScale>
                      <div className="max-w-screen-2xl mx-auto w-full">
                        <div className="pn-leaderboard" />

                        <ErrorBoundary>
                          <Outlet key={location.pathname} />
                        </ErrorBoundary>
                      </div>
                    </PnPageAutoScale>
                  </div>
                  <aside className="pn-sidebar" aria-label="Advertisement" />
                </div>
              </div>
            </main>

            {/* Footer */}
            <footer className="border-t border-[#726e97] mt-10 relative overflow-hidden">
              {/* ASCII shard watermark */}
              <div className="absolute inset-x-0 top-8 flex justify-center pointer-events-none select-none" aria-hidden>
                <pre className="text-[#83b5d1]/[0.05] leading-tight text-[10px] sm:text-xs whitespace-pre">{SHARD_ASCII}</pre>
              </div>

              {/* 3-column footer */}
              <div className="border-t border-[#726e97]">
                <div className="max-w-screen-2xl mx-auto px-6 py-8 grid grid-cols-1 md:grid-cols-3 gap-8">
                  {/* About */}
                  <div>
                    <p className="mono-label text-[#83b5d1]/70 mb-3">+--- ABOUT ---+</p>
                    <p className="text-sm text-[#83b5d1]/70">&gt; HYPIXEL SKYBLOCK FUSION CALCULATOR</p>
                    <p className="text-sm text-[#83b5d1]/50">&gt; BUILT BY CAMPION + XKAPY</p>
                    <p className="text-sm text-[#83b5d1]/50">&gt; DATA: HSFEARLESS, MAXLUNAR, WHATYOUTHING</p>
                    <p className="text-sm text-[#7698b3]/80 mt-2">
                      &gt; PRICES: SKYCOFL <span className="text-[#83b5d1]">[OK]</span>
                    </p>
                  </div>

                  {/* Navigate */}
                  <div>
                    <p className="mono-label text-[#83b5d1]/70 mb-3">+--- NAVIGATE ---+</p>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        { to: "/", label: "> /calculator" },
                        { to: "/recipes", label: "> /recipes" },
                        { to: "/profitability", label: "> /profit" },
                        { to: "/shards", label: "> /shards" },
                        { to: "/guide", label: "> /guide" },
                        { to: "/about", label: "> /about" },
                        { to: "/contact", label: "> /contact" },
                        { to: "/privacy-policy", label: "> /privacy" },
                      ].map(({ to, label }) => (
                        <Link
                          key={to}
                          to={to}
                          className="text-sm text-[#83b5d1]/70 hover:text-[#83b5d1] hover:bg-[#83b5d1]/10 px-2 py-0.5 transition-colors duration-150 cursor-pointer"
                        >
                          {label}
                        </Link>
                      ))}
                    </div>
                  </div>

                  {/* Connect */}
                  <div className="md:text-right">
                    <p className="mono-label text-[#83b5d1]/70 mb-3">+--- CONNECT ---+</p>
                    <div className="flex gap-2 md:justify-end">
                      {[
                        { href: "https://github.com/Campionnn/SkyShards", label: "[GH]", aria: "GitHub" },
                        { href: "https://ko-fi.com/skyshards", label: "[KOFI]", aria: "Buy us a coffee" },
                        { href: "https://greenhouse.skyshards.com", label: "[GHO]", aria: "Greenhouse" },
                      ].map(({ href, label, aria }) => (
                        <a
                          key={href}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={aria}
                          title={aria}
                          className="px-3 py-1.5 border border-[#726e97] text-[#83b5d1]/70 hover:text-black hover:bg-[#83b5d1] hover:border-[#83b5d1] transition-colors duration-150 mono-label"
                        >
                          {label}
                        </a>
                      ))}
                    </div>
                    <p className="mono-label text-[#83b5d1]/40 mt-6">© {new Date().getFullYear()} SKYSHARDS</p>
                    <p className="mono-label text-[#83b5d1]/40">
                      ALL SYSTEMS <span className="text-[#83b5d1]">[OK]</span>
                      <span className="animate-blink ml-1">█</span>
                    </p>
                  </div>
                </div>
              </div>
            </footer>
          </div>
        </div>
      </div>

      <GreenhouseModal open={showGreenhouseModal} onClose={handleCloseGreenhouseModal} />
    </div>
  );
};
