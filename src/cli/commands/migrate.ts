/**
 * `aster-audit migrate [--dry-run]` — copy the legacy `~/.aster-agent-console`
 * data directory to `~/.aster-agent-audit`.
 *
 * Design (REFACTOR_PLAN.md D3–D5), in priority order: data safety first.
 *
 *  - The legacy directory is NEVER modified — no file inside it is touched,
 *    moved, or deleted. The single exception is one added marker file
 *    (MIGRATED.json) after a successful migration. The untouched legacy
 *    directory IS the backup.
 *  - The new directory is built under a `.partial` staging name and renamed
 *    into place only when complete, so a failed or interrupted migration can
 *    never leave a half-built directory that resolveConfigDir would pick up —
 *    the app keeps starting from the legacy data.
 *  - The SQLite DB is copied with better-sqlite3's backup API (consistent
 *    even under WAL), never with a raw file copy. The collector must be
 *    stopped first; we probe and refuse rather than risk a torn copy.
 *  - The spool is live payload, not a code path: on the machine this was
 *    designed against it held 19k+ events the collector had not yet ingested.
 *    It is carried verbatim and drained later by the normal replay path.
 *  - `codex-import.json` (the Codex rollout dedupe cursor) is carried
 *    verbatim; losing it would re-import every Codex session as duplicates.
 *  - config.json's absolute dbPath is rewritten from the old prefix.
 *  - Hook scripts are REGENERATED, not copied: old generated scripts have the
 *    legacy spool path baked in. Live hook entries in ~/.claude/settings.json
 *    (and a managed ~/.codex/config.toml block, if present) are re-pointed,
 *    each with a timestamped backup taken first.
 *  - Re-running is safe: a completed migration is detected via the marker and
 *    reported as such; nothing is redone.
 */
import Database from "better-sqlite3";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import pc from "picocolors";
import {
  DATA_DIR_NAME,
  DB_FILE_NAME,
  LEGACY_DATA_DIR_NAME,
  LEGACY_FORWARD_MARKER_FILE,
  MIGRATION_MARKER_FILE,
  CLI_NAME,
} from "../../core/branding";
import { HOST, PORT } from "../util/paths";
import { heading, line, sym } from "../util/ui";
import { hookScript } from "../hooks/script";

// Stamped by tsup; "dev" under tsx.
declare const __AAC_VERSION__: string;
const VERSION = typeof __AAC_VERSION__ === "string" ? __AAC_VERSION__ : "dev";

export type MigrateOptions = {
  dryRun?: boolean;
  /** Overridable for tests. */
  home?: string;
  /** Overridable for tests — reports whether a collector is serving the DB. */
  collectorUp?: () => Promise<boolean>;
};

export type MigrateStep = { kind: "copy" | "rewrite" | "generate" | "repoint" | "marker"; detail: string };

export type MigratePlan =
  | { state: "nothing-to-migrate"; steps: [] }
  | { state: "already-migrated"; steps: [] }
  | { state: "conflict"; steps: []; reason: string }
  | { state: "ready"; steps: MigrateStep[]; legacyDir: string; nextDir: string };

function sizeOf(path: string): string {
  try {
    const st = statSync(path);
    if (st.isDirectory()) return "dir";
    const mb = st.size / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(st.size / 1024).toFixed(0)} KB`;
  } catch {
    return "?";
  }
}

/** Files/dirs carried from the legacy dir, in copy order. DB is handled separately. */
const CARRY = ["config.json", "codex-import.json", "policy.json", "spool", "backups"] as const;

export function planMigration(home: string = homedir()): MigratePlan {
  const legacyDir = join(home, LEGACY_DATA_DIR_NAME);
  const nextDir = join(home, DATA_DIR_NAME);

  if (existsSync(join(nextDir, MIGRATION_MARKER_FILE))) return { state: "already-migrated", steps: [] };
  if (!existsSync(legacyDir)) return { state: "nothing-to-migrate", steps: [] };
  if (existsSync(nextDir))
    return {
      state: "conflict",
      steps: [],
      reason:
        `${nextDir} already exists but has no migration marker. ` +
        `Refusing to overwrite it. If it holds nothing you need, remove it and re-run; ` +
        `if it holds real data, keep whichever directory is current and remove the other.`,
    };

  const steps: MigrateStep[] = [];
  const db = join(legacyDir, DB_FILE_NAME);
  if (existsSync(db)) steps.push({ kind: "copy", detail: `${DB_FILE_NAME} (${sizeOf(db)}, via SQLite backup API)` });
  for (const name of CARRY) {
    const src = join(legacyDir, name);
    if (!existsSync(src)) continue;
    if (name === "config.json") steps.push({ kind: "rewrite", detail: `config.json (dbPath ${legacyDir} → ${nextDir})` });
    else steps.push({ kind: "copy", detail: `${name} (${sizeOf(src)})` });
  }
  if (existsSync(join(legacyDir, "hooks")))
    steps.push({ kind: "generate", detail: "hooks/ regenerated (old scripts spool into the legacy dir by baked-in path)" });
  const claudeSettings = join(home, ".claude", "settings.json");
  if (existsSync(claudeSettings) && readFileSync(claudeSettings, "utf8").includes(legacyDir))
    steps.push({ kind: "repoint", detail: `~/.claude/settings.json hook commands → ${nextDir} (backup first)` });
  const codexConfig = join(home, ".codex", "config.toml");
  if (existsSync(codexConfig) && readFileSync(codexConfig, "utf8").includes(legacyDir))
    steps.push({ kind: "repoint", detail: `~/.codex/config.toml managed block → ${nextDir} (backup first)` });
  steps.push({ kind: "marker", detail: `${MIGRATION_MARKER_FILE} written to ${nextDir}; ${LEGACY_FORWARD_MARKER_FILE} added to ${legacyDir}` });
  return { state: "ready", steps, legacyDir, nextDir };
}

async function defaultCollectorUp(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(`http://${HOST}:${PORT}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** Timestamped backup of a user config file into the NEW dir's backups/. */
function backupInto(nextDir: string, file: string): string {
  const dir = join(nextDir, "backups");
  mkdirSync(dir, { recursive: true });
  const stampStr = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(dir, `${basename(file)}.${stampStr}.bak`);
  copyFileSync(file, dest);
  return dest;
}

export async function runMigration(opts: MigrateOptions = {}): Promise<{ ok: boolean; state: string }> {
  const home = opts.home ?? homedir();
  const plan = planMigration(home);

  heading("Migrate data directory");
  if (plan.state === "already-migrated") {
    line(`${sym.ok} Already migrated — ${join(home, DATA_DIR_NAME)} is current. Nothing to do.`);
    return { ok: true, state: plan.state };
  }
  if (plan.state === "nothing-to-migrate") {
    line(`${sym.ok} No legacy ${LEGACY_DATA_DIR_NAME} directory found. Nothing to migrate.`);
    return { ok: true, state: plan.state };
  }
  if (plan.state === "conflict") {
    line(`${sym.fail} ${plan.reason}`);
    process.exitCode = 1;
    return { ok: false, state: plan.state };
  }

  const { legacyDir, nextDir } = plan;
  line(`  From  ${pc.dim(legacyDir)}  ${pc.dim("(kept untouched — this is the backup)")}`);
  line(`  To    ${pc.dim(nextDir)}`);
  line("");
  for (const s of plan.steps) line(`  ${pc.dim(s.kind.padEnd(8))} ${s.detail}`);
  line("");

  if (opts.dryRun) {
    line(`${sym.ok} Dry run — nothing was changed.`);
    return { ok: true, state: "dry-run" };
  }

  const up = await (opts.collectorUp ?? defaultCollectorUp)();
  if (up) {
    line(`${sym.fail} A collector is running on ${HOST}:${PORT}. Stop it first so the DB copy is consistent:`);
    line(`     ${CLI_NAME} service uninstall   (or close the dashboard)`);
    process.exitCode = 1;
    return { ok: false, state: "collector-running" };
  }

  // Build in a staging dir; rename into place only when complete, so a failed
  // run leaves resolveConfigDir still pointing at the intact legacy data.
  const partial = `${nextDir}.partial`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });

  const dbSrc = join(legacyDir, DB_FILE_NAME);
  if (existsSync(dbSrc)) {
    const db = new Database(dbSrc, { readonly: true });
    try {
      await db.backup(join(partial, DB_FILE_NAME));
    } finally {
      db.close();
    }
  }

  for (const name of CARRY) {
    const src = join(legacyDir, name);
    if (!existsSync(src)) continue;
    if (name === "config.json") {
      const rewritten = readFileSync(src, "utf8").split(legacyDir).join(nextDir);
      writeFileSync(join(partial, "config.json"), rewritten);
    } else {
      cpSync(src, join(partial, name), { recursive: true });
    }
  }

  // Regenerate hook scripts (never copy: legacy scripts spool into the legacy dir).
  const legacyHooks = join(legacyDir, "hooks");
  if (existsSync(legacyHooks)) {
    const hooksDir = join(partial, "hooks");
    mkdirSync(hooksDir, { recursive: true });
    const endpoint = `http://${HOST}:${PORT}/events`;
    for (const agent of ["claude-code", "codex"] as const) {
      const name = `${agent}-hook.mjs`;
      if (existsSync(join(legacyHooks, name)))
        writeFileSync(join(hooksDir, name), hookScript(agent, endpoint), { mode: 0o755 });
    }
  }

  const carried = plan.steps.map((s) => `${s.kind}: ${s.detail}`);
  writeFileSync(
    join(partial, MIGRATION_MARKER_FILE),
    JSON.stringify({ from: legacyDir, to: nextDir, at: new Date().toISOString(), version: VERSION, steps: carried }, null, 2) + "\n"
  );

  renameSync(partial, nextDir); // atomic cutover — from here resolveConfigDir picks the new dir

  // Re-point live agent configs (backups go into the NEW dir's backups/).
  const repointed: string[] = [];
  for (const file of [join(home, ".claude", "settings.json"), join(home, ".codex", "config.toml")]) {
    if (!existsSync(file)) continue;
    const body = readFileSync(file, "utf8");
    if (!body.includes(legacyDir)) continue;
    const bak = backupInto(nextDir, file);
    writeFileSync(file, body.split(legacyDir).join(nextDir));
    repointed.push(`${file} (backup: ${bak})`);
  }

  // The ONLY write ever made into the legacy dir: a forward marker.
  writeFileSync(
    join(legacyDir, LEGACY_FORWARD_MARKER_FILE),
    JSON.stringify({ movedTo: nextDir, at: new Date().toISOString(), note: "Data was COPIED, not moved. This directory is the pre-migration backup." }, null, 2) + "\n"
  );

  line(`${sym.ok} Migrated. ${pc.dim(`${legacyDir} is untouched and serves as the backup.`)}`);
  for (const r of repointed) line(`  ${sym.ok} Re-pointed ${r}`);
  line("");
  line(`  Next: run ${pc.bold(`${CLI_NAME} doctor`)} to confirm, and if you use the background`);
  line(`  service, reinstall it with ${pc.bold(`${CLI_NAME} service install`)} (the label changed).`);
  return { ok: true, state: "migrated" };
}

export async function migrateCmd(opts: { dryRun?: boolean }): Promise<void> {
  await runMigration({ dryRun: opts.dryRun });
}
