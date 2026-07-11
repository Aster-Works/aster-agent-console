#!/usr/bin/env node
/**
 * aster-audit CLI.
 *
 *   aster-audit dashboard      start the local console and open the browser
 *   aster-audit doctor         check local health
 *   aster-audit init [--dry-run]   set up local files and detect agents
 *   aster-audit migrate [--dry-run] move data from the legacy directory
 *
 * `aster-agent` remains a working alias during the migration period.
 * The server binds to 127.0.0.1 only and never executes incoming commands.
 */
import { basename } from "node:path";
import { Command } from "commander";
import { CLI_NAME, LEGACY_CLI_NAME } from "../core/branding";
import { dashboard } from "./commands/dashboard";
import { doctor } from "./commands/doctor";
import { init } from "./commands/init";
import { migrateCmd } from "./commands/migrate";
import { policyTestCmd, policyValidateCmd } from "./commands/policy";
import { reportCmd } from "./commands/report";
import { verifyCmd } from "./commands/verify";
import { scanCmd } from "./commands/scan";
import { serve } from "./commands/serve";
import { serviceInstall, serviceStatus, serviceUninstall } from "./commands/service";
import { hooksStatusCmd, hooksUninstallCmd, installHooksCmd } from "./commands/hooks";

// Stamped by tsup from package.json; undefined when run from source via tsx.
declare const __AAC_VERSION__: string;

// Invoked through the legacy bin name? Same behavior — just a gentle note on
// stderr so scripts parsing stdout are unaffected.
if (basename(process.argv[1] ?? "") === LEGACY_CLI_NAME) {
  console.error(
    `\`${LEGACY_CLI_NAME}\` is now \`${CLI_NAME}\`.\n` +
      `The old command remains available during the migration period.\n`
  );
}

const program = new Command();

program
  .name(CLI_NAME)
  .description("Local-first audit and security observability for AI coding agents")
  .version(typeof __AAC_VERSION__ === "string" ? __AAC_VERSION__ : "dev");

const port = (v: string) => Number.parseInt(v, 10);

program
  .command("dashboard")
  .description("Start the local server, serve the dashboard, and open the browser")
  .option("-p, --port <number>", "port to bind on 127.0.0.1", port)
  .option("--db <path>", "path to the SQLite database")
  .option("--no-open", "do not open the browser automatically")
  .action((opts) => dashboard({ port: opts.port, db: opts.db, open: opts.open }));

program
  .command("doctor")
  .description("Check Node version, storage, collector health, and hook status")
  .option("-p, --port <number>", "collector port to probe", port)
  .option("--db <path>", "path to the SQLite database")
  .action((opts) => doctor({ port: opts.port, db: opts.db }));

program
  .command("init")
  .description("Create local files and detect Claude Code / Codex config")
  .option("--dry-run", "detect possible hook config but do not modify or create anything")
  .option("--install-hooks", "install collector hooks into detected agents (backs up first)")
  .option("-y, --yes", "skip the confirmation prompt when installing hooks")
  .option("--no-service", "with --install-hooks, skip installing the always-on background collector")
  .action((opts) =>
    init({ dryRun: opts.dryRun, installHooks: opts.installHooks, yes: opts.yes, noService: opts.service === false })
  );

program
  .command("scan")
  .description("Scan local MCP configuration for security risks (read-only, never executes)")
  .argument("[dir]", "project directory to scan (defaults to the current directory)")
  .action((dir) => scanCmd(dir));

program
  .command("serve")
  .description("Run the collector headlessly (no browser) — what the background service runs")
  .option("-p, --port <number>", "port to bind on 127.0.0.1", port)
  .option("--db <path>", "path to the SQLite database")
  .action((opts) => serve({ port: opts.port, db: opts.db }));

const service = program
  .command("service")
  .description("Manage the always-on background collector (collects while no dashboard is open)");
service
  .command("install")
  .description("Install and start the background collector (macOS launchd; runs at login)")
  .action(() => serviceInstall());
service
  .command("uninstall")
  .description("Stop and remove the background collector")
  .action(() => serviceUninstall());
service
  .command("status")
  .description("Show background collector status")
  .action(() => serviceStatus());

const hooks = program.command("hooks").description("Manage Claude Code / Codex collector hooks");
hooks
  .command("status")
  .description("Show whether collector hooks are installed")
  .action(() => hooksStatusCmd());
hooks
  .command("install")
  .description("Install collector hooks into detected agents (backs up existing config)")
  .option("--dry-run", "preview without modifying anything")
  .option("-y, --yes", "skip the confirmation prompt")
  .action((opts) => installHooksCmd({ dryRun: opts.dryRun, yes: opts.yes }));
hooks
  .command("uninstall")
  .description("Remove collector hooks (backs up before changing)")
  .action(() => hooksUninstallCmd());

const policy = program.command("policy").description("Validate and inspect the finding policy (policy.json)");
policy
  .command("validate")
  .description("Validate user + repo-local policy files; exit non-zero on errors")
  .argument("[dir]", "repository directory for the repo-local policy (defaults to the current directory)")
  .action((dir) => policyValidateCmd(dir));
policy
  .command("test")
  .description("Show the effective policy: sources, suppressed rules, severity overrides, scan gate")
  .argument("[dir]", "repository directory for the repo-local policy (defaults to the current directory)")
  .action((dir) => policyTestCmd(dir));

program
  .command("report")
  .description("Generate a report. Implemented: --type evidence (machine-readable bundle with chain hashes)")
  .option("--type <type>", "report type (evidence; security/activity/html arrive later and fail loudly)", "evidence")
  .option("--session <id>", "limit to a single session")
  .option("--out <file>", "write to a file instead of stdout")
  .option("--db <path>", "path to the SQLite database")
  .action((opts) => reportCmd({ type: opts.type, session: opts.session, out: opts.out, db: opts.db }));

program
  .command("verify")
  .description("Verify the event hash chain (tamper-evidence; read-only). Exit 1 on a break")
  .option("--session <id>", "verify a single session")
  .option("--format <fmt>", "output format: text (default) or json")
  .option("--db <path>", "path to the SQLite database")
  .action((opts) => verifyCmd({ session: opts.session, format: opts.format, db: opts.db }));

program
  .command("migrate")
  .description(
    "Copy data from the legacy ~/.aster-agent-console directory to ~/.aster-agent-audit " +
      "(the legacy directory is never modified and remains the backup)"
  )
  .option("--dry-run", "show exactly what would be copied and rewritten, change nothing")
  .action((opts) => migrateCmd({ dryRun: opts.dryRun }));

program.parseAsync(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
