import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type AgentConsoleDb } from "../src/db/index";
import { verifyChain } from "../src/core/integrity/index";
import { verifySessions } from "../src/cli/commands/verify";
import type { NormalizedAgentEvent } from "../src/core/types";

let dir: string;
let db: AgentConsoleDb;

const ev = (id: string, over: Partial<NormalizedAgentEvent> = {}): NormalizedAgentEvent => ({
  id,
  agent: "claude-code",
  source: "hook",
  type: "post_tool_use",
  sessionId: "s1",
  timestamp: "2026-07-11T00:00:00Z",
  receivedAt: "2026-07-11T00:00:01Z",
  title: "Bash complete",
  input: { value: { command: `cmd for ${id}` }, redactions: [] },
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aaa-chain-"));
  db = openDb(join(dir, "t.db"));
  db.upsertSession({ id: "s1", agent: "claude-code", startedAt: "2026-07-11T00:00:00Z", status: "active" });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("hash chain through the real DB", () => {
  it("chains inserts and verifies intact", () => {
    for (const id of ["e1", "e2", "e3"]) db.insertEvent(ev(id));
    const r = verifyChain(db.integrityRows("s1"));
    expect(r).toEqual({ status: "verified", checked: 3, legacy: 0 });
  });

  it("re-ingesting the same event (insert or replace) keeps the chain intact AND its position", () => {
    for (const id of ["e1", "e2", "e3"]) db.insertEvent(ev(id));
    // Codex cursor-loss re-import: same payload, later receivedAt.
    db.insertEvent(ev("e2", { receivedAt: "2026-07-12T09:00:00Z" }));
    const rows = db.integrityRows("s1");
    expect(rows.map((r) => r.event.id)).toEqual(["e1", "e2", "e3"]); // chain_seq preserved, not rowid
    expect(verifyChain(rows).status).toBe("verified");
  });

  it("re-ingesting an event with DIFFERENT content is detected at the next link", () => {
    for (const id of ["e1", "e2", "e3"]) db.insertEvent(ev(id));
    db.insertEvent(ev("e2", { input: { value: { command: "something else entirely" }, redactions: [] } }));
    const r = verifyChain(db.integrityRows("s1"));
    expect(r.status).toBe("broken");
    expect(r.breakAt?.eventId).toBe("e3"); // e3's prevHash no longer matches e2's new hash
  });

  it("direct SQL tampering with a stored event is detected", () => {
    for (const id of ["e1", "e2"]) db.insertEvent(ev(id));
    db.raw.prepare(`update events set input_json = ? where id = 'e1'`).run(
      JSON.stringify({ value: { command: "rewritten by attacker" }, redactions: [] })
    );
    const r = verifyChain(db.integrityRows("s1"));
    expect(r.status).toBe("broken");
    expect(r.breakAt?.eventId).toBe("e1");
  });

  it("enrichment (links/metrics/title UPDATE) does NOT break the chain", () => {
    for (const id of ["e1", "e2"]) db.insertEvent(ev(id));
    db.enrichEvent("e1", JSON.stringify({ files: ["/repo/a.ts"] }), JSON.stringify({ durationMs: 9 }), "enriched");
    expect(verifyChain(db.integrityRows("s1")).status).toBe("verified");
  });

  it("pre-migration rows verify as legacy-unverified; new rows after them chain cleanly", () => {
    // Simulate a legacy row: insert, then null out its chain columns as a
    // pre-v2 DB would have them.
    db.insertEvent(ev("old1"));
    db.raw.prepare(`update events set prev_hash = null, hash = null, chain_seq = null where id = 'old1'`).run();
    expect(verifyChain(db.integrityRows("s1"))).toEqual({ status: "legacy-unverified", checked: 0, legacy: 1 });

    db.insertEvent(ev("new1"));
    db.insertEvent(ev("new2"));
    const r = verifyChain(db.integrityRows("s1"));
    expect(r).toEqual({ status: "verified", checked: 2, legacy: 1 });
  });

  it("verifySessions aggregates per session and separates the verdicts", () => {
    db.upsertSession({ id: "s2", agent: "codex", startedAt: "2026-07-11T01:00:00Z", status: "active" });
    db.insertEvent(ev("a1"));
    db.insertEvent(ev("b1", { sessionId: "s2", agent: "codex" }));
    db.raw.prepare(`update events set summary = 'tampered' where id = 'b1'`).run();

    const dbPath = join(dir, "t.db");
    db.close();
    const verdicts = verifySessions(dbPath);
    expect(verdicts.find((v) => v.sessionId === "s1")?.status).toBe("verified");
    expect(verdicts.find((v) => v.sessionId === "s2")?.status).toBe("broken");
    db = openDb(dbPath); // afterEach closes it
  });

  it("opening a pre-v2 database migrates it in place and keeps every row readable", () => {
    // Build a DB, strip the integrity columns to simulate v1, then reopen.
    const oldPath = join(dir, "old.db");
    const old = openDb(oldPath);
    old.upsertSession({ id: "s9", agent: "codex", startedAt: "2026-07-11T02:00:00Z", status: "active" });
    old.insertEvent(ev("z1", { sessionId: "s9", agent: "codex" }));
    // SQLite can't DROP COLUMN pre-3.35 style safely with indexes; emulate a
    // legacy DB by nulling values AND resetting user_version.
    old.raw.prepare(`update events set prev_hash = null, hash = null, chain_seq = null`).run();
    old.raw.pragma("user_version = 0");
    old.close();

    const re = openDb(oldPath);
    expect(re.raw.pragma("user_version", { simple: true })).toBe(3);
    expect(re.getEvents("s9")).toHaveLength(1);
    expect(verifyChain(re.integrityRows("s9")).status).toBe("legacy-unverified");
    re.close();
  });
});
