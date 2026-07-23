import React, { useEffect } from "react";
import { imagePreloader, SHARD_ICON_IDS } from "../utilities";

interface ImagePreloadProviderProps {
  children: React.ReactNode;
}

export const ImagePreloadProvider: React.FC<ImagePreloadProviderProps> = ({ children }) => {
  useEffect(() => {
    imagePreloader.preloadShardIcons(SHARD_ICON_IDS).catch((error) => {
      console.error("Failed to preload images:", error);
    });
  }, []);

  return <>{children}</>;
};
