import { describe, it, expect } from "vitest";
import { openDb } from "../src/db/index";
import { buildPlist } from "../src/cli/commands/service";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe("pruneOlderThan (retention)", () => {
  it("drops sessions older than N days and keeps recent ones", () => {
    const db = openDb(":memory:");
    db.upsertSession({ id: "old", agent: "claude-code", startedAt: daysAgo(40) });
    db.upsertSession({ id: "recent", agent: "claude-code", startedAt: daysAgo(2) });

    const removed = db.pruneOlderThan(30);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(db.getSession("old")).toBeUndefined();
    expect(db.getSession("recent")).toBeDefined();
    db.close();
  });

  it("is a no-op for 0 or negative days", () => {
    const db = openDb(":memory:");
    db.upsertSession({ id: "x", agent: "claude-code", startedAt: daysAgo(100) });
    expect(db.pruneOlderThan(0)).toBe(0);
    expect(db.pruneOlderThan(-5)).toBe(0);
    expect(db.getSession("x")).toBeDefined();
    db.close();
  });
});

describe("buildPlist", () => {
  it("produces a launchd plist that runs `serve` at load and keeps alive", () => {
    const p = buildPlist("/usr/bin/node", "/pkg/dist-cli/index.js", "/logs/service.log");
    // Deliberately a literal: the plist must carry the NEW label (the legacy
    // com.asterworks.agent-console label is only ever read, never written).
    expect(p).toContain("com.asterworks.agent-audit");
    expect(p).not.toContain("com.asterworks.agent-console.plist");
    expect(p).toContain("<string>/usr/bin/node</string>");
    expect(p).toContain("<string>/pkg/dist-cli/index.js</string>");
    expect(p).toContain("<string>serve</string>");
    expect(p).toContain("<key>RunAtLoad</key>");
    expect(p).toContain("<key>KeepAlive</key>");
    expect(p).toContain("/logs/service.log");
  });
});
