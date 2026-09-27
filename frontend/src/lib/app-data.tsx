import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  fetchAgentHealth,
  fetchInsights,
  fetchKOLFeed,
  fetchKOLRankings,
  fetchKOLs,
  fetchTokenDetail,
  fetchTokenList,
  fetchTrendingTokens,
  fetchValidation,
} from "../api/trustTrace";
import { adaptAppSnapshot, tokenKey } from "./adapters";
import type { AppSnapshot, AssetData, KOL } from "../types";

type AppDataContextValue = {
  snapshot: AppSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getAssetByKey: (chainId: string, contractAddress: string) => AssetData | undefined;
  getKOLById: (handle: string) => KOL | undefined;
};

const AppDataContext = createContext<AppDataContextValue | null>(null);

async function fetchAlertDetails(
  items: Array<{ chain_id: string; contract_address: string }>,
  concurrency = 4,
) {
  const details = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = await Promise.allSettled(
      items
        .slice(index, index + concurrency)
        .map((item) => fetchTokenDetail(item.chain_id, item.contract_address)),
    );
    details.push(...batch.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])));
  }
  return details;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapshotRef = useRef<AppSnapshot | null>(null);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const load = useCallback(async (manualRefresh = false) => {
    setLoading(!snapshotRef.current);
    setRefreshing(manualRefresh || Boolean(snapshotRef.current));
    setError(null);

    try {
      const [agentHealth, validation, tokenList, trending, insights, kols, kolRankings, feed] =
        await Promise.all([
          fetchAgentHealth(),
          fetchValidation(),
          fetchTokenList(100),
          fetchTrendingTokens(50),
          fetchInsights(50),
          fetchKOLs(),
          fetchKOLRankings(50),
          fetchKOLFeed(40),
        ]);

      const alertCandidates = tokenList.items.slice(0, 12);
        const alertDetails = await fetchAlertDetails(alertCandidates);

      setSnapshot(
        adaptAppSnapshot({
          agentHealth,
          validation,
          tokenList,
          trending,
          insights,
          kols,
          kolRankings,
          feed,
          alertDetails,
        }),
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to load the TrustTrace app snapshot.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<AppDataContextValue>(
    () => ({
      snapshot,
      loading,
      refreshing,
      error,
      refresh: () => load(true),
      getAssetByKey: (chainId, contractAddress) =>
        snapshot?.assets[tokenKey(chainId, contractAddress)],
      getKOLById: (handle) => snapshot?.kols[handle.replace(/^@/, "")],
    }),
    [error, load, loading, refreshing, snapshot],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const context = useContext(AppDataContext);

  if (!context) {
    throw new Error("useAppData must be used within AppDataProvider.");
  }

  return context;
}
