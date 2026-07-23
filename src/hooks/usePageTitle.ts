import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export const usePageTitle = () => {
  const location = useLocation();

  useEffect(() => {
    const getTitle = () => {
      const path = location.pathname;

      switch (path) {
        case "/":
          return "SkyShards · Calculator";
        case "/recipes":
          return "SkyShards · Recipes";
        case "/profitability":
          return "SkyShards · Profitability";
        case "/shards":
          return "SkyShards · Shards";
        case "/guide":
          return "SkyShards · Guide";
        case "/about":
          return "SkyShards · About";
        case "/contact":
          return "SkyShards · Contact";
        case "/privacy-policy":
        case "/client-privacy-policy":
          return "SkyShards · Privacy Policy";
        default:
          return "SkyShards · Calculator";
      }
    };

    document.title = getTitle();
  }, [location.pathname]);
};
