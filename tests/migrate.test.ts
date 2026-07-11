import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planMigration, runMigration } from "../src/cli/commands/migrate";
import { resolveConfigDir, openDb } from "../src/db/index";

/**
 * Full-fidelity fake of a legacy install under a temp HOME, modeled on the
 * REAL machine this migration was designed against: a populated DB, a live
 * spool with un-ingested events, the Codex import cursor, a config.json with
 * an ABSOLUTE dbPath, hook scripts, dotfile backups, and live hook entries in
 * ~/.claude/settings.json.
 */
let home: string;
const legacy = () => join(home, ".aster-agent-console");
const next = () => join(home, ".aster-agent-audit");
const collectorDown = async () => false;

function seedLegacyInstall(): void {
  const dir = legacy();
  mkdirSync(join(dir, "spool"), { recursive: true });
  mkdirSync(join(dir, "hooks"), { recursive: true });
  mkdirSync(join(dir, "backups"), { recursive: true });

  const db = openDb(join(dir, "agent-console.db"));
  db.upsertSession({ id: "s1", agent: "claude-code", startedAt: "2026-07-10T00:00:00Z", status: "completed" });
  db.close();

  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({ version: 1, dbPath: join(dir, "agent-console.db"), retentionDays: 30 }, null, 2)
  );
  writeFileSync(join(dir, "codex-import.json"), JSON.stringify({ "/Users/x/.codex/sessions/r.jsonl": { lines: 42, mtime: 1 } }));
  writeFileSync(join(dir, "spool", "spool.jsonl"), '{"agent":"claude-code","payload":{}}\n'.repeat(3));
  writeFileSync(join(dir, "hooks", "claude-code-hook.mjs"), "// legacy script with baked-in .aster-agent-console spool path\n");
  writeFileSync(join(dir, "backups", "settings.json.old.bak"), "{}");

  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(
    join(home, ".claude", "settings.json"),
    JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `node ${join(dir, "hooks", "claude-code-hook.mjs")}` }] }] },
    }, null, 2)
  );
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "aaa-migrate-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("resolveConfigDir", () => {
  it("fresh machine → new dir name", () => {
    expect(resolveConfigDir(home)).toBe(next());
  });
  it("legacy-only machine → keeps using the legacy dir (no silent migration)", () => {
    mkdirSync(legacy(), { recursive: true });
    expect(resolveConfigDir(home)).toBe(legacy());
  });
  it("after migration → the new dir wins", () => {
    mkdirSync(legacy(), { recursive: true });
    mkdirSync(next(), { recursive: true });
    expect(resolveConfigDir(home)).toBe(next());
  });
});

describe("migrate", () => {
  it("dry-run plans everything and changes NOTHING", async () => {
    seedLegacyInstall();
    const before = readFileSync(join(home, ".claude", "settings.json"), "utf8");
    const res = await runMigration({ home, dryRun: true, collectorUp: collectorDown });
    expect(res).toEqual({ ok: true, state: "dry-run" });
    expect(existsSync(next())).toBe(false);
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe(before);

    const plan = planMigration(home);
    if (plan.state !== "ready") throw new Error(plan.state);
    const kinds = plan.steps.map((s) => s.kind);
    expect(kinds).toContain("copy"); // db + spool + cursor + backups
    expect(kinds).toContain("rewrite"); // config.json dbPath
    expect(kinds).toContain("generate"); // hooks regenerated, not copied
    expect(kinds).toContain("repoint"); // ~/.claude/settings.json
    expect(kinds).toContain("marker");
  });

  it("migrates: copies everything, rewrites paths, re-points hooks, leaves legacy untouched", async () => {
    seedLegacyInstall();
    const res = await runMigration({ home, collectorUp: collectorDown });
    expect(res).toEqual({ ok: true, state: "migrated" });

    // Everything carried.
    const db = new Database(join(next(), "agent-console.db"), { readonly: true });
    expect(db.prepare("select count(*) c from sessions").get()).toEqual({ c: 1 });
    db.close();
    expect(readFileSync(join(next(), "spool", "spool.jsonl"), "utf8").trim().split("\n")).toHaveLength(3);
    expect(JSON.parse(readFileSync(join(next(), "codex-import.json"), "utf8"))["/Users/x/.codex/sessions/r.jsonl"].lines).toBe(42);
    expect(existsSync(join(next(), "backups", "settings.json.old.bak"))).toBe(true);

    // config.json dbPath rewritten to the new dir.
    const cfg = JSON.parse(readFileSync(join(next(), "config.json"), "utf8"));
    expect(cfg.dbPath).toBe(join(next(), "agent-console.db"));

    // Hook script REGENERATED (script-relative spool), not the legacy copy.
    const hook = readFileSync(join(next(), "hooks", "claude-code-hook.mjs"), "utf8");
    expect(hook).toContain("fileURLToPath(import.meta.url)");
    expect(hook).not.toContain("baked-in");

    // Live settings.json re-pointed, with a backup taken into the NEW dir.
    const settings = readFileSync(join(home, ".claude", "settings.json"), "utf8");
    expect(settings).toContain(join(next(), "hooks", "claude-code-hook.mjs"));
    expect(settings).not.toContain(".aster-agent-console");

    // Markers on both sides.
    const marker = JSON.parse(readFileSync(join(next(), "migration.json"), "utf8"));
    expect(marker.from).toBe(legacy());
    expect(JSON.parse(readFileSync(join(legacy(), "MIGRATED.json"), "utf8")).movedTo).toBe(next());

    // The legacy dir's DATA is untouched (marker is the only addition).
    expect(readFileSync(join(legacy(), "config.json"), "utf8")).toContain(legacy());
    expect(readFileSync(join(legacy(), "spool", "spool.jsonl"), "utf8").trim().split("\n")).toHaveLength(3);

    // From now on resolution picks the new dir.
    expect(resolveConfigDir(home)).toBe(next());
  });

  it("is idempotent — a second run is a no-op", async () => {
    seedLegacyInstall();
    await runMigration({ home, collectorUp: collectorDown });
    const res = await runMigration({ home, collectorUp: collectorDown });
    expect(res).toEqual({ ok: true, state: "already-migrated" });
  });

  it("refuses when both dirs exist without a marker (never overwrites)", async () => {
    seedLegacyInstall();
    mkdirSync(next(), { recursive: true });
    writeFileSync(join(next(), "something.txt"), "user data");
    const res = await runMigration({ home, collectorUp: collectorDown });
    expect(res.ok).toBe(false);
    expect(res.state).toBe("conflict");
    expect(readFileSync(join(next(), "something.txt"), "utf8")).toBe("user data");
    process.exitCode = 0;
  });

  it("refuses while a collector is running (consistent DB copy)", async () => {
    seedLegacyInstall();
    const res = await runMigration({ home, collectorUp: async () => true });
    expect(res).toEqual({ ok: false, state: "collector-running" });
    expect(existsSync(next())).toBe(false);
    process.exitCode = 0;
  });

  it("nothing to migrate on a fresh machine", async () => {
    const res = await runMigration({ home, collectorUp: collectorDown });
    expect(res).toEqual({ ok: true, state: "nothing-to-migrate" });
  });

  it("a leftover .partial from a crashed run never becomes the active dir", async () => {
    seedLegacyInstall();
    // Simulate a crash: stale partial exists, new dir does not.
    mkdirSync(`${next()}.partial`, { recursive: true });
    writeFileSync(join(`${next()}.partial`, "stale.txt"), "half-built");
    expect(resolveConfigDir(home)).toBe(legacy()); // resolution ignores .partial
    const res = await runMigration({ home, collectorUp: collectorDown });
    expect(res.state).toBe("migrated");
    expect(existsSync(join(next(), "stale.txt"))).toBe(false); // rebuilt from scratch
  });
});
