import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import pc from "picocolors";
import { openDb } from "../../db/index";
import {
  CONFIG_DIR,
  CONFIG_FILE,
  DB_PATH,
  HOOKS_DIR,
  SPOOL_DIR,
  BACKUP_DIR,
  PORT,
} from "../util/paths";
import { detectAgents } from "../util/detect";
import { brand, check, heading, line, sym } from "../util/ui";
import { installHooksCmd } from "./hooks";

export type InitOptions = { dryRun?: boolean; installHooks?: boolean; yes?: boolean; noService?: boolean };

const DEFAULT_CONFIG = {
  version: 1,
  host: "127.0.0.1",
  port: PORT,
  dbPath: DB_PATH,
  redaction: { enabled: true },
  risk: { enabled: true },
  cloudSync: false,
};

export async function init(opts: InitOptions = {}): Promise<void> {
  const dryRun = opts.dryRun ?? false;

  brand();
  line(
    dryRun
      ? pc.dim("\nDry run — nothing will be written. Showing what `aster-audit init` would do.\n")
      : ""
  );

  // 1. Local directories / DB (our own files only).
  heading("Local setup");
  const dirs = [
    { path: CONFIG_DIR, label: "Config directory" },
    { path: HOOKS_DIR, label: "Hooks directory" },
    { path: SPOOL_DIR, label: "Spool directory" },
    { path: BACKUP_DIR, label: "Backups directory" },
  ];
  for (const d of dirs) {
    const exists = existsSync(d.path);
    if (dryRun) {
      check(exists ? true : "warn", d.label, exists ? "exists" : `would create ${d.path}`);
    } else {
      if (!exists) mkdirSync(d.path, { recursive: true });
      check(true, d.label, d.path);
    }
  }

  // config.json
  const cfgExists = existsSync(CONFIG_FILE);
  if (dryRun) {
    check(cfgExists ? true : "warn", "config.json", cfgExists ? "exists" : "would be created");
  } else {
    if (!cfgExists) writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    check(true, "config.json", CONFIG_FILE);
  }

  // SQLite schema
  if (dryRun) {
    check(existsSync(DB_PATH) ? true : "warn", "SQLite database", existsSync(DB_PATH) ? "exists" : `would initialize ${DB_PATH}`);
  } else {
    const db = openDb(DB_PATH);
    db.close();
    check(true, "SQLite database", DB_PATH);
  }

  // 2. Detect agents and their hook config (read-only).
  heading("Detected agents");
  const agents = detectAgents();
  let anyAgent = false;
  for (const a of agents) {
    if (a.present) {
      anyAgent = true;
      check(true, a.label, a.hookInstalled ? "hook already installed" : "detected");
      for (const cp of a.configPaths.filter((p) => p.exists)) {
        line(`      ${sym.bullet} ${pc.dim(`${cp.scope}: ${cp.path}`)}`);
      }
    } else {
      check("warn", a.label, "not detected");
    }
  }
  if (!anyAgent) {
    line(`  ${pc.dim("No Claude Code or Codex config found. You can still explore with demo data.")}`);
  }

  // 3. Hook installation + always-on background collector (default with hooks).
  if (opts.installHooks) {
    await installHooksCmd({ dryRun, yes: opts.yes });
    if (!dryRun && !opts.noService) {
      const { serviceInstall } = await import("./service");
      serviceInstall({ skipBrand: true });
    } else if (opts.noService) {
      heading("Background collector");
      line(`  ${sym.info} Skipped (--no-service). Enable later with ${pc.cyan("aster-audit service install")}.`);
    }
  } else {
    heading("Hook installation");
    line(`  ${sym.info} Hooks are not installed by default. To collect real activity, run:`);
    line(`     ${pc.cyan("aster-audit init --install-hooks")} ${pc.dim("(existing config is backed up first)")}`);
    for (const a of agents.filter((x) => x.present && !x.hookInstalled)) {
      const target = a.configPaths.find((p) => p.exists)?.path ?? a.configPaths[0].path;
      line(
        `  ${sym.arrow} Would add an Aster collector hook to ${pc.cyan(a.label)} ${pc.dim(`→ ${target} (backup → ${BACKUP_DIR})`)}`
      );
    }
  }

  heading("Next steps");
  if (dryRun) {
    line(`  ${sym.bullet} Run ${pc.cyan("aster-audit init")} to create local files (no agent files touched).`);
  }
  line(`  ${sym.bullet} Run ${pc.cyan("aster-audit dashboard")} to open the console.`);
  line(`  ${sym.bullet} Run ${pc.cyan("aster-audit doctor")} to verify your setup.`);
  line("");
}
