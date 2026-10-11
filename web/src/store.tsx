import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_CHAIN, type ChainConfig } from "./config";
import { loadSnapshot } from "./chain";
import { errorMessage } from "./domain";
import type { Snapshot } from "./types";
interface Store {
  config: ChainConfig;
  setConfig: (c: ChainConfig) => void;
  data?: Snapshot;
  loading: boolean;
  error: string;
  progress: string;
  now: bigint;
  refresh: () => Promise<boolean>;
}
const Context = createContext<Store>(null!);
export const useData = () => useContext(Context);
export function DataProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState(DEFAULT_CHAIN),
    [data, setData] = useState<Snapshot>();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [progress, setProgress] = useState("Connecting to the chain…");
  const [now, setNow] = useState(BigInt(Math.floor(Date.now() / 1000)));
  const generation = useRef(0),
    inFlight = useRef<Promise<boolean> | undefined>(undefined);
  const refresh = useCallback(async () => {
    const request = generation.current;
    // A post-transaction refresh must start after any older in-flight snapshot.
    while (inFlight.current) await inFlight.current;
    if (generation.current !== request) return false;
    const task = (async () => {
      setLoading(true);
      setError("");
      try {
        const next = await loadSnapshot(config, setProgress);
        if (generation.current !== request) return false;
        setData(next);
        setNow(next.timestamp);
        return true;
      } catch (e) {
        if (generation.current === request) setError(errorMessage(e));
        return false;
      } finally {
        if (generation.current === request) setLoading(false);
      }
    })();
    inFlight.current = task;
    const result = await task;
    if (inFlight.current === task) inFlight.current = undefined;
    return result;
  }, [config]);
  useEffect(() => {
    generation.current++;
    inFlight.current = undefined;
    setData(undefined);
    void refresh();
    const id = window.setInterval(() => {
      if (!document.hidden && !inFlight.current) void refresh();
    }, 30000);
    return () => {
      generation.current++;
      clearInterval(id);
    };
  }, [refresh]);
  useEffect(() => {
    const id = window.setInterval(
      () =>
        setNow(
          data
            ? data.timestamp +
                BigInt(Math.floor((Date.now() - data.loadedAt) / 1000))
            : BigInt(Math.floor(Date.now() / 1000)),
        ),
      1000,
    );
    return () => clearInterval(id);
  }, [data]);
  return (
    <Context.Provider
      value={{
        config,
        setConfig,
        data,
        loading,
        error,
        progress,
        now,
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
