import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db/index";
import { createCollector } from "../src/server/collector";
import { buildEvidenceBundle } from "../src/server/evidence";

const RAW_SECRET = "sk-ant-abcdefghijklmnopqrstu456789";

describe("evidence bundle", () => {
  it("carries events+hashes+findings+verification, and NO raw secret crosses the export boundary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aaa-evidence-"));
    const db = openDb(join(dir, "e.db"));
    const collector = createCollector(db);

    // Through the REAL ingest path — not hand-built rows.
    collector.ingest("claude-code", {
      hook_event_name: "PreToolUse",
      session_id: "s-evidence",
      tool_name: "Bash",
      tool_input: { command: `export ANTHROPIC_API_KEY=${RAW_SECRET} && ./deploy.sh` },
      cwd: "/tmp/repo",
    });
    collector.ingest("claude-code", {
      hook_event_name: "PostToolUse",
      session_id: "s-evidence",
      tool_name: "Bash",
      tool_input: { command: "git push --force origin main" },
      cwd: "/tmp/repo",
    });

    const bundle = buildEvidenceBundle(db, {
      productVersion: "test",
      policy: { effective: {}, sources: [] },
    });

    // Structure: meta + verification verdict computed at export time.
    expect(bundle.meta.integritySchemaVersion).toBe(1);
    expect(bundle.meta.dbSchemaVersion).toBe(2);
    expect(bundle.counts.events).toBe(2);
    expect(bundle.verification).toHaveLength(1);
    expect(bundle.verification[0]).toMatchObject({ sessionId: "s-evidence", status: "verified", checked: 2 });

    // Every event carries its chain link.
    for (const e of bundle.events) expect(e.hash).toBeTruthy();

    // Findings made it (secret exposure + force push), with rule ids.
    expect(bundle.findings.length).toBeGreaterThanOrEqual(2);
    expect(bundle.findings.map((f) => f.ruleId)).toContain("AAC-SECRET-001");

    // THE export-boundary guarantee: the raw secret appears NOWHERE in the
    // serialized bundle — not in events, not in finding evidence.
    expect(JSON.stringify(bundle)).not.toContain(RAW_SECRET);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("filters to one session when asked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aaa-evidence2-"));
    const db = openDb(join(dir, "e.db"));
    const collector = createCollector(db);
    for (const sid of ["sA", "sB"]) {
      collector.ingest("codex", {
        hook_event_name: "PreToolUse",
        session_id: sid,
        tool_name: "exec_command",
        tool_input: { command: "ls" },
      });
    }
    const bundle = buildEvidenceBundle(db, {
      productVersion: "test",
      sessionId: "sA",
      policy: { effective: {}, sources: [] },
    });
    expect(bundle.counts.sessions).toBe(1);
    expect(bundle.events.every((e) => e.sessionId === "sA")).toBe(true);
    expect(bundle.meta.filters).toEqual({ sessionId: "sA" });
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
