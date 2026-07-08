/**
 * Client-side filtering for the top-bar controls (agent / repo / date / search).
 * The controls were previously decorative; this re-aggregates the dataset from
 * the filtered raw rows so every screen reflects the selection. Pure — reuses
 * the same core aggregation the live/demo paths use.
 */
import type { AgentName } from "@core/types";
import type { Dataset } from "@core/views";
import { buildOverview, buildRepoActivity } from "@core/aggregate";
import { eventSearchText } from "../lib/describe";

export type Filters = {
  agentFilter: AgentName | "all";
  repo: string;
  dateRange: string;
  search: string;
};

function base(p?: string): string {
  if (!p) return "unknown";
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** Real repo names present in the dataset, for the top-bar dropdown. */
export function repoOptions(dataset: Dataset): string[] {
  return [...new Set(dataset.sessions.map((s) => base(s.repoPath)))].sort();
}

function cutoff(dateRange: string): number {
  const now = Date.now();
  if (dateRange === "all") return -Infinity; // audit tool: everything stored must be reachable
  if (dateRange === "7d") return now - 7 * 86_400_000;
  if (dateRange === "30d") return now - 30 * 86_400_000;
  const d = new Date(); // "today" → local midnight
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * A session belongs in the window if it was still running inside it. Testing
 * only `startedAt` makes a long multi-day session — and every event in it —
 * vanish as a unit the moment its start crosses the boundary.
 */
function sessionEnd(s: { startedAt: string; endedAt?: string }): number {
  const started = Date.parse(s.startedAt);
  const ended = Date.parse(s.endedAt ?? "");
  return Number.isNaN(ended) ? started : Math.max(started, ended);
}

export function applyFilters(dataset: Dataset, f: Filters): Dataset {
  const repos = new Set(dataset.sessions.map((s) => base(s.repoPath)));
  const repoFilter = f.repo !== "all" && repos.has(f.repo) ? f.repo : null; // ignore stale repo
  const since = cutoff(f.dateRange);
  const q = f.search.trim().toLowerCase();

  const sessions = dataset.sessions.filter((s) => {
    if (f.agentFilter !== "all" && s.agent !== f.agentFilter) return false;
    if (repoFilter && base(s.repoPath) !== repoFilter) return false;
    const t = sessionEnd(s);
    if (!Number.isNaN(t) && t < since) return false;
    if (q) {
      const hay = `${s.summary ?? ""} ${s.repoPath ?? ""} ${s.id}`.toLowerCase();
      const inSession = hay.includes(q);
      // Also match on what the agent actually did inside the session.
      const inEvents = (dataset.eventsBySession[s.id] ?? []).some((e) => eventSearchText(e).includes(q));
      if (!inSession && !inEvents) return false;
    }
    return true;
  });

  const ids = new Set(sessions.map((s) => s.id));
  // MCP config-scan findings aren't tied to a session/agent — always keep them.
  const risk = dataset.risk.filter((r) => ids.has(r.sessionId) || r.sessionId === "mcp-config-scan");
  const fileChanges = dataset.fileChanges.filter((fc) => ids.has(fc.sessionId));
  const eventsBySession = Object.fromEntries(
    Object.entries(dataset.eventsBySession).filter(([id]) => ids.has(id))
  );
  const gitTimeline = dataset.repoActivity.gitTimeline.filter(
    (c) => f.agentFilter === "all" || c.agent === f.agentFilter
  );

  const overview = buildOverview(sessions, risk, fileChanges, eventsBySession, dataset.overview.range);
  const repoActivity = buildRepoActivity(
    dataset.repoActivity.repo,
    fileChanges,
    sessions,
    gitTimeline,
    risk
  );

  return { ...dataset, sessions, risk, fileChanges, eventsBySession, overview, repoActivity };
}
