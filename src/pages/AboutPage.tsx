import React, { useState, useRef } from "react";
import { Info, Check, Mail, Copy } from "lucide-react";
import { DiscordIcon } from "../components/ui/DiscordIcon";
import { Divider } from "../components/ui/Divider";

export const AboutPage: React.FC = () => {
  const [copied, setCopied] = useState<{ [key: string]: boolean }>({});
  const timeouts = useRef<{ [key: string]: ReturnType<typeof setTimeout> }>({});

  const handleCopy = (tag: string) => {
    navigator.clipboard.writeText(tag);
    setCopied((prev) => ({ ...prev, [tag]: true }));
    if (timeouts.current[tag]) {
      clearTimeout(timeouts.current[tag]);
    }
    timeouts.current[tag] = setTimeout(() => {
      setCopied((prev) => ({ ...prev, [tag]: false }));
      delete timeouts.current[tag];
    }, 1200);
  };

  return (
    <div className="max-w-xl mx-auto py-10 px-4">
      <div className="glass glass-hover p-8 text-slate-200">
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-[#83b5d1]/10 border border-[#83b5d1]/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Info className="w-8 h-8 text-[#83b5d1]" />
        </div>
      </div>
      <h1 className="text-3xl font-bold mb-4 text-slate-100 tracking-tight">About SkyShards</h1>
      <p className="mb-2 text-slate-400">
        SkyShards is a tool designed to help you calculate, plan, and optimize your shard fusions in the game. This project is open source and not affiliated with the game developers.
      </p>
      <Divider />
      <div className="mb-4 flex items-center gap-2">
        <Mail className="w-5 h-5 text-white mx-[3.5px]" />
        <a href="mailto:skyshardsdev@gmail.com" className="text-[#83b5d1] underline">
          skyshardsdev@gmail.com
        </a>
      </div>
      <div className="mb-4 flex gap-2 items-center">
        <DiscordIcon className="w-7 h-7" />
        <div className="relative flex flex-col items-center min-w-[80px]">
          <button className="font-mono cursor-pointer text-[#83b5d1] bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5 flex items-center gap-1 hover:bg-white/10 transition" onClick={() => handleCopy("campionn")}>
            campionn
            <Copy className="w-4 h-4 text-white" />
          </button>
          {copied["campionn"] && (
            <span className="animate-copied absolute left-1/2 -translate-x-1/2 top-full mt-1 text-green-500 text-xs flex items-center gap-1 pointer-events-none">
              <Check className="w-3 h-3" /> Copied!
            </span>
          )}
        </div>
        <span className="font-semibold text-slate-300">or</span>
        <div className="relative flex flex-col items-center min-w-[80px]">
          <button className="font-mono cursor-pointer text-[#83b5d1] bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5 flex items-center gap-1 hover:bg-white/10 transition" onClick={() => handleCopy("xkapy")}>
            xkapy
            <Copy className="w-4 h-4 text-white" />
          </button>
          {copied["xkapy"] && (
            <span className="animate-copied absolute left-1/2 -translate-x-1/2 top-full mt-1 text-green-500 text-xs flex items-center gap-1 pointer-events-none">
              <Check className="w-3 h-3" /> Copied!
            </span>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};
