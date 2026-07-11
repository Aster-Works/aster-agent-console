import { accessSync, constants, existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pc from "picocolors";
import { openDb } from "../../db/index";
import {
  CLI_NAME,
  DATA_DIR_NAME,
  LEGACY_DATA_DIR_NAME,
  MIGRATION_MARKER_FILE,
} from "../../core/branding";
import { CONFIG_DIR, DB_PATH, PORT, HOST, SPOOL_DIR } from "../util/paths";
import { detectAgents } from "../util/detect";
import { scanMcpEnvironment } from "../../server/mcp-scan";
import { brand, check, heading, line } from "../util/ui";

async function probeServer(port: number): Promise<"running" | "down"> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(`http://${HOST}:${port}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok ? "running" : "down";
  } catch {
    return "down";
  }
}

export async function doctor(opts: { port?: number; db?: string } = {}): Promise<void> {
  const port = opts.port ?? PORT;
  const dbPath = opts.db ?? DB_PATH;
  let problems = 0;

  brand();
  heading("Environment");
  const major = Number(process.versions.node.split(".")[0]);
  const nodeOk = major >= 20;
  check(nodeOk, "Node.js ≥ 20", `v${process.versions.node}`);
  if (!nodeOk) problems++;

  heading("Local storage");
  let dirOk = true;
  try {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    accessSync(CONFIG_DIR, constants.W_OK);
    check(true, "Data directory writable", CONFIG_DIR);
  } catch {
    dirOk = false;
    problems++;
    check(false, "Data directory writable", CONFIG_DIR);
  }

  // Migration status (the data dir was renamed with the product).
  const home = homedir();
  const legacyDir = join(home, LEGACY_DATA_DIR_NAME);
  const nextDir = join(home, DATA_DIR_NAME);
  const migrated = existsSync(join(nextDir, MIGRATION_MARKER_FILE));
  if (migrated) {
    check(true, "Data migration", `done — ${nextDir} is current (${legacyDir} kept as backup)`);
  } else if (existsSync(legacyDir) && existsSync(nextDir)) {
    problems++;
    check(
      false,
      "Data migration",
      `both ${LEGACY_DATA_DIR_NAME} and ${DATA_DIR_NAME} exist with no migration marker — resolve manually (see \`${CLI_NAME} migrate\`)`
    );
  } else if (existsSync(legacyDir)) {
    check(
      "warn",
      "Data migration",
      `using legacy ${LEGACY_DATA_DIR_NAME} — run \`${CLI_NAME} migrate\` when ready (copy-based, old dir kept as backup)`
    );
  }

  // Spooled events waiting for a collector are silent data debt — surface them.
  try {
    const spoolFile = join(SPOOL_DIR, "spool.jsonl");
    if (existsSync(spoolFile)) {
      const mb = statSync(spoolFile).size / (1024 * 1024);
      if (mb >= 0.1) {
        check(
          "warn",
          "Spooled events",
          `${mb.toFixed(1)} MB waiting — start the collector to ingest them (\`${CLI_NAME} dashboard\` or \`${CLI_NAME} service install\`)`
        );
      }
    }
  } catch {
    /* spool unreadable — nothing actionable to report */
  }

  if (dirOk) {
    try {
      const db = openDb(dbPath);
      const c = db.counts();
      // Chain coverage (cheap count, not a full verify — that is `verify`'s job).
      const cov = db.raw
        .prepare(`select count(*) as total, count(hash) as hashed from events`)
        .get() as { total: number; hashed: number };
      db.close();
      check(true, "Database readable", `${dbPath} · ${c.sessions} sessions, ${c.events} events`);
      if (cov.total > 0) {
        const legacy = cov.total - cov.hashed;
        check(
          legacy === 0 ? true : "warn",
          "Audit chain coverage",
          legacy === 0
            ? `all ${cov.hashed} events hashed (run \`${CLI_NAME} verify\` to check integrity)`
            : `${cov.hashed} hashed, ${legacy} pre-chaining (legacy-unverified) — new events are chained automatically`
        );
      }
    } catch (err) {
      problems++;
      check(false, "Database readable", String((err as Error).message));
    }
  }

  heading("Collector");
  const state = await probeServer(port);
  if (state === "running") {
    check(true, "Local server", `running at http://${HOST}:${port}`);
  } else {
    check("warn", "Local server", `not running · start with '${CLI_NAME} dashboard'`);
  }
  check(true, "Bind address", `${HOST} only (no external access)`);

  heading("Agent integrations");
  const agents = detectAgents();
  for (const a of agents) {
    if (!a.present) {
      check("warn", a.label, "not detected on this machine");
    } else if (a.hookInstalled) {
      // Honest labels: Codex has no hook — its session logs are read directly.
      check(true, a.label, a.mechanism === "hook" ? "hook installed" : "collecting (reads session logs, no config change)");
    } else {
      check("warn", a.label, `detected · not collecting (run \`${CLI_NAME} init\`)`);
    }
  }

  heading("MCP security posture");
  try {
    const scan = scanMcpEnvironment({ configDir: CONFIG_DIR });
    if (scan.summary.serverCount === 0) {
      check("warn", "MCP config scan", "no MCP servers found");
    } else {
      const clean = scan.findings.length === 0;
      check(
        clean ? true : "warn",
        "MCP config scan",
        `${scan.summary.serverCount} server(s) · ${scan.findings.length} finding(s) · grade ${scan.summary.grade}` +
          `  ${pc.dim(`(${CLI_NAME} scan for detail)`)}`
      );
    }
  } catch {
    check("warn", "MCP config scan", "could not read MCP configuration");
  }

  heading("Summary");
  if (problems === 0) {
    line(`  ${pc.green("All core checks passed.")} ${pc.dim(`Run \`${CLI_NAME} dashboard\` to view your console.`)}`);
  } else {
    line(`  ${pc.red(`${problems} issue(s) found.`)} ${pc.dim("See the checks above.")}`);
    process.exitCode = 1;
  }
  line("");
}
