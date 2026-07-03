/**
 * Global UI state: top-bar filters, data-source mode, and the assembled
 * dataset. Phase 1 is demo-only; Phase 2 adds a `live` mode that pulls from the
 * local collector and falls back to demo data when the DB is empty or offline.
 */
import { create } from "zustand";
import type { AgentName } from "@core/types";
import type { Dataset } from "@core/views";
import { getDemoDataset, fetchLiveDataset } from "../data/source";

export type AgentFilter = AgentName | "all";
export type SourceMode = "demo" | "live";
export type LiveState = "idle" | "loading" | "ready" | "empty" | "error";

type AppState = {
  source: SourceMode;
  liveState: LiveState;
  dataset: Dataset;
  repo: string;
  agentFilter: AgentFilter;
  dateRange: string;
  search: string;
  setSource: (s: SourceMode) => void;
  loadLive: () => Promise<void>;
  setRepo: (r: string) => void;
  setAgentFilter: (a: AgentFilter) => void;
  setDateRange: (d: string) => void;
  setSearch: (q: string) => void;
};

let sse: EventSource | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  source: "demo",
  liveState: "idle",
  dataset: getDemoDataset(),
  repo: "all",
  agentFilter: "all",
  dateRange: "today",
  search: "",

  setSource: (source) => {
    if (source === "demo") {
      sse?.close();
      sse = null;
      set({ source: "demo", liveState: "idle", dataset: getDemoDataset() });
    } else {
      set({ source: "live" });
      void get().loadLive();
    }
  },

  loadLive: async () => {
    set({ liveState: "loading" });
    const ds = await fetchLiveDataset();
    if (ds) {
      set({ dataset: ds, liveState: "ready", source: "live" });
      connectSse(get().loadLive);
      return;
    }
    // No dataset yet. Distinguish "collector up but empty" from "offline" so a
    // freshly-hooked user who just hasn't run an agent yet stays connected and
    // flips to live the moment their first event lands.
    const online = await probeHealth();
    if (online) {
      set({ source: "live", liveState: "empty", dataset: getDemoDataset() });
      connectSse(get().loadLive);
    } else {
      sse?.close();
      sse = null;
      set({ source: "demo", liveState: "error", dataset: getDemoDataset() });
    }
  },

  setRepo: (repo) => set({ repo }),
  setAgentFilter: (agentFilter) => set({ agentFilter }),
  setDateRange: (dateRange) => set({ dateRange }),
  setSearch: (search) => set({ search }),
}));

async function probeHealth(): Promise<boolean> {
  try {
    const r = await fetch("/health", { headers: { accept: "application/json" } });
    return r.ok;
  } catch {
    return false;
  }
}

function connectSse(onEvent: () => void) {
  if (sse) return;
  try {
    sse = new EventSource("/api/live");
    let t: ReturnType<typeof setTimeout> | null = null;
    sse.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { kind?: string };
        if (msg.kind === "event") {
          // Debounce refetch on a burst of events.
          if (t) clearTimeout(t);
          t = setTimeout(onEvent, 400);
        }
      } catch {
        /* ignore */
      }
    };
    sse.onerror = () => {
      sse?.close();
      sse = null;
    };
  } catch {
    sse = null;
  }
}
