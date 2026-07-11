import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db/index";
import { createCollector } from "../src/server/collector";
import type { NormalizedAgentEvent, RiskFinding } from "../src/core/types";

function seed() {
  const db = openDb(":memory:");
  db.upsertSession({ id: "s1", agent: "codex", startedAt: "2026-07-04T00:00:00Z" });
  const event: NormalizedAgentEvent = {
    id: "evt1",
    agent: "codex",
    source: "import",
    type: "post_tool_use",
    sessionId: "s1",
    repoPath: "/repo",
    timestamp: "2026-07-04T00:00:01Z",
    receivedAt: "2026-07-04T00:00:01Z",
    title: "cat .env",
  };
  db.insertEvent(event);
  const finding: RiskFinding = {
    id: "risk_abc",
    ruleId: "AAC-SECRET-001",
    severity: "high",
    category: "secrets",
    title: "Secret detected in tool input",
    description: "A secret was detected and redacted.",
    recommendedAction: "Rotate the secret.",
  };
  db.insertRisk(finding, { eventId: "evt1", sessionId: "s1", agent: "codex", repoPath: "/repo", timestamp: "2026-07-04T00:00:01Z" });
  return { db, findingId: "s1:risk_abc" }; // db stores id as `${sessionId}:${finding.id}`
}

describe("risk finding resolution (never deletes the record)", () => {
  it("resolve marks the finding resolved; reopen restores it", () => {
    const { db, findingId } = seed();
    expect(db.getRisk()[0].status).toBe("open");

    expect(db.setRiskStatus(findingId, "resolved")).toBe("s1");
    expect(db.getRisk()[0].status).toBe("resolved");
    // the underlying record is kept — resolving is not deleting
    expect(db.getEvents("s1")).toHaveLength(1);
    expect(db.getRisk()).toHaveLength(1);

    expect(db.setRiskStatus(findingId, "open")).toBe("s1");
    expect(db.getRisk()[0].status).toBe("open");
    db.close();
  });

  it("resolving a missing finding is a safe no-op", () => {
    const { db } = seed();
    expect(db.setRiskStatus("nope", "resolved")).toBeUndefined();
    expect(db.getRisk()[0].status).toBe("open"); // untouched
    db.close();
  });
});

describe("finding lifecycle v3 (extended statuses + append-only history)", () => {
  it("accepted-risk / false-positive are valid states and every transition is recorded", () => {
    const dir = mkdtempSync(join(tmpdir(), "aaa-lifecycle-"));
    const db = openDb(join(dir, "l.db"));
    const collector = createCollector(db);
    collector.ingest("claude-code", {
      hook_event_name: "PreToolUse",
      session_id: "s-lc",
      tool_name: "Bash",
      tool_input: { command: "git push --force origin main" },
    });
    const finding = db.getRisk()[0];
    expect(finding.status).toBe("open");

    db.setRiskStatus(finding.id, "acknowledged");
    db.setRiskStatus(finding.id, "accepted-risk", "force-push is deliberate in this repo");
    db.setRiskStatus(finding.id, "false-positive");
    db.setRiskStatus(finding.id, "open", "re-triaged");

    const history = db.getFindingHistory(finding.id);
    expect(history.map((h) => h.toStatus)).toEqual(["acknowledged", "accepted-risk", "false-positive", "open"]);
    expect(history.map((h) => h.fromStatus)).toEqual(["open", "acknowledged", "accepted-risk", "false-positive"]);
    expect(history[1].note).toBe("force-push is deliberate in this repo");
    // The finding row still exists — nothing was deleted.
    expect(db.getRisk().find((f) => f.id === finding.id)).toBeDefined();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("MCP inventory (fingerprint + change detection)", () => {
  it("first scan = added; same scan = unchanged; edits = changed; disappearance = removed", async () => {
    const { fingerprintServer } = await import("../src/core/mcp");
    const dir = mkdtempSync(join(tmpdir(), "aaa-inv-"));
    const db = openDb(join(dir, "i.db"));
    const mk = (name: string, command: string, env?: Record<string, string>) => ({
      name,
      sourceFile: "/home/u/.codex/config.toml",
      agent: "codex",
      ...fingerprintServer({ name, command, env }),
    });

    const first = db.recordMcpInventory([mk("magic", "npx"), mk("db", "docker")]);
    expect(first.added.map((r) => r.name).sort()).toEqual(["db", "magic"]);
    expect(first.changed).toEqual([]);

    const second = db.recordMcpInventory([mk("magic", "npx"), mk("db", "docker")]);
    expect(second.added).toEqual([]);
    expect(second.unchanged).toBe(2);

    // command changed → changed; db server vanished → removed
    const third = db.recordMcpInventory([mk("magic", "bash")]);
    expect(third.changed.map((c) => c.after.name)).toEqual(["magic"]);
    expect(third.removed.map((r) => r.name)).toEqual(["db"]);

    // env VALUES are never stored — names only.
    db.recordMcpInventory([mk("sec", "npx", { API_KEY: "raw-secret-value-123" })]);
    const stored = db.getMcpInventory().find((r) => r.name === "sec")!;
    expect(stored.definition.envNames).toEqual(["API_KEY"]);
    expect(JSON.stringify(db.getMcpInventory())).not.toContain("raw-secret-value-123");

    // a value-only rotation is NOT a config change (deliberate)
    const rotate = db.recordMcpInventory([mk("sec", "npx", { API_KEY: "different-value-456" })]);
    expect(rotate.changed).toEqual([]);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
