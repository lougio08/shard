import { useState, useEffect } from "react";
import type { FusionData } from "../utilities";
import { DataService } from "../services/dataService";

export const useFusionData = () => {
  const [fusionData, setFusionData] = useState<FusionData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const dataService = DataService.getInstance();
        const data = await dataService.loadFusionData();
        setFusionData(data);
      } catch (error) {
        console.error("Failed to load fusion data:", error);
        setFusionData(null);
      } finally {
        setLoading(false);
      }
    };
    loadData().catch(console.error);
  }, []);

  return { fusionData, loading };
};
