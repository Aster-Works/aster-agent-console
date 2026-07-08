import { describe, it, expect } from "vitest";
import { getDemoDataset } from "../src/web/data/source";
import { applyFilters, repoOptions } from "../src/web/data/filter";

describe("applyFilters (top-bar filters)", () => {
  const ds = getDemoDataset();

  it("filters by agent and re-aggregates the overview", () => {
    const r = applyFilters(ds, { agentFilter: "claude-code", repo: "all", dateRange: "30d", search: "" });
    expect(r.sessions.length).toBeGreaterThan(0);
    expect(r.sessions.length).toBeLessThan(ds.sessions.length);
    expect(r.sessions.every((s) => s.agent === "claude-code")).toBe(true);
    expect(r.overview.totals.sessions).toBe(r.sessions.length);
    expect(r.overview.perAgent.find((a) => a.agent === "codex")?.sessions).toBe(0);
  });

  it("repoOptions lists real repo basenames and the repo filter narrows sessions", () => {
    const repos = repoOptions(ds);
    expect(repos.length).toBeGreaterThan(0);
    const r = applyFilters(ds, { agentFilter: "all", repo: repos[0], dateRange: "30d", search: "" });
    expect(r.sessions.length).toBeGreaterThan(0);
    expect(r.sessions.every((s) => (s.repoPath?.split("/").pop() ?? "unknown") === repos[0])).toBe(true);
  });

  it("a stale/unknown repo value is ignored (treated as all)", () => {
    const r = applyFilters(ds, { agentFilter: "all", repo: "no-such-repo", dateRange: "30d", search: "" });
    expect(r.sessions.length).toBe(ds.sessions.length);
  });

  it("date range never adds sessions", () => {
    const r = applyFilters(ds, { agentFilter: "all", repo: "all", dateRange: "today", search: "" });
    expect(r.sessions.length).toBeLessThanOrEqual(ds.sessions.length);
  });

  // The demo used to be pinned to a hardcoded day. Once that day aged out of the
  // default 7d window, every screen of a fresh install rendered empty — and every
  // test here passed, because they all asked for "30d".
  it("the demo is never empty at the DEFAULT date range", () => {
    for (const dateRange of ["today", "7d", "30d", "all"]) {
      const r = applyFilters(ds, { agentFilter: "all", repo: "all", dateRange, search: "" });
      expect(r.sessions.length, `dateRange=${dateRange}`).toBeGreaterThan(0);
    }
  });

  it('"all time" reaches every stored session', () => {
    const r = applyFilters(ds, { agentFilter: "all", repo: "all", dateRange: "all", search: "" });
    expect(r.sessions.length).toBe(ds.sessions.length);
  });

  it("keeps a session that started before the window but ran inside it", () => {
    const old = ds.sessions[0];
    const straddling = {
      ...old,
      id: "straddling",
      startedAt: new Date(Date.now() - 9 * 86_400_000).toISOString(), // before the 7d cutoff
      endedAt: new Date(Date.now() - 1 * 86_400_000).toISOString(), // still running inside it
    };
    const r = applyFilters(
      { ...ds, sessions: [straddling] },
      { agentFilter: "all", repo: "all", dateRange: "7d", search: "" }
    );
    expect(r.sessions.map((s) => s.id)).toContain("straddling");
  });

  it("search matches what the agent did inside a session, not just its metadata", () => {
    const sess = ds.sessions[0];
    const events = ds.eventsBySession[sess.id] ?? [];
    const withCmd = { ...events[0], id: "needle-ev", input: { value: { command: "rg -n zzunlikelyzz src" }, redactions: [] } };
    const r = applyFilters(
      { ...ds, sessions: [sess], eventsBySession: { [sess.id]: [withCmd] } } as typeof ds,
      { agentFilter: "all", repo: "all", dateRange: "all", search: "zzunlikelyzz" }
    );
    expect(r.sessions.map((s) => s.id)).toContain(sess.id);
  });
});
