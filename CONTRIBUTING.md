# Contributing

Thanks for helping build **Aster Agent Audit** (`@asterworks/agent-audit`) — a local-first safety, work-audit, and outcome dashboard for Claude Code and Codex. This guide gets you from clone to green tests. It's a beta; honesty and small, tested changes are more valuable than big ones.

## Prerequisites

- **Node >= 20** (the package is ESM, `"type": "module"`)
- **pnpm 9.15** — the pinned `packageManager` is `pnpm@9.15.0`

```bash
node --version   # v20 or newer
pnpm --version   # 9.15.x
```

## Setup

```bash
pnpm install
```

On some machines `corepack pnpm` fails on signature-key verification. If that happens, disable the corepack version check:

```bash
COREPACK_DEFAULT_TO_LATEST=0 pnpm install
```

If `pnpm` still won't run scripts, invoke the tools directly from `./node_modules/.bin/`:

```bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc -p tsconfig.json --noEmit
./node_modules/.bin/vite
./node_modules/.bin/tsup
```

## Dev loop

```bash
pnpm dev              # Vite dev server on http://127.0.0.1:5173
pnpm test             # vitest run (one-shot)
pnpm test:watch       # vitest in watch mode
pnpm typecheck        # web/client tsconfig
pnpm typecheck:server # server tsconfig
pnpm typecheck:all    # both
pnpm build:all        # tsc + vite build (dist/web) then tsup (dist-cli/)
```

In dev the dashboard runs on `127.0.0.1:5173` and proxies `/api`, `/events`, and `/health` to the collector on `127.0.0.1:48321`. To exercise the CLI without building:

```bash
pnpm aster-agent <command>   # runs src/cli/index.ts via tsx (package.json script name is unchanged)
```

## Project layout

```
src/
  core/     shared types + logic (redaction, risk, mcp, policy, classify, aggregate)
  web/      React dashboard (routes/, components/, data/); Vite + Tailwind
  db/       SQLite via better-sqlite3 (WAL); DEFAULT_CONFIG_DIR = ~/.aster-agent-audit
  server/   local collector + JSON API + SSE + MCP scan (index, collector, mcp-scan, spool)
  cli/      commander CLI (index.ts, commands/, util/)
  cli/hooks/  agent hook installer + hook script
```

Key files you'll touch most:

- `src/core/risk.ts` — command/file/secret rules (`COMMAND_RULES`)
- `src/core/mcp.ts` — MCP config rules (`MCP_RULES`) and posture scoring
- `src/core/redaction.ts` — `redactString` / `redactJson`
- `src/core/policy.ts` — `policy.json` handling
- `src/server/index.ts` — the local server (`HOST`/`PORT`, host-header guard)

## House rules

These are load-bearing invariants. A change that breaks one should not merge.

1. **Every non-trivial change needs a test.** vitest lives alongside the code; add or extend a `*.test.ts` next to what you changed.
2. **Secrets are redacted before storage.** Anything that reaches the DB, an event title, or the spool must pass through `redactString`/`redactJson` first. Findings carry `redactedEvidence` — never a raw secret.
3. **Hook and config edits back up first.** Installers must write a backup before modifying `settings.json` / `config.toml`, and `uninstall` must fully restore from it. Preserve existing user config.
4. **The server stays `127.0.0.1`-only and never executes incoming commands.** Keep the host-header guard, the JSON-only + 512KB body limit, and the rule that commands are inspected as text, never run.

Redaction is best-effort defense-in-depth, and the MCP scan is static and heuristic — don't write copy or code that implies either is a guarantee.

## Adding a risk rule

Command/file/secret rules live in `COMMAND_RULES` in `src/core/risk.ts`. Add an entry with an `AAC-*` id (e.g. `AAC-SHELL-0NN`, `AAC-GIT-0NN`), following the existing shape:

```ts
{
  ruleId: "AAC-SHELL-020",
  // pattern / matcher, severity, category,
  // title, description, recommendedAction
}
```

Every finding must include `severity`, `category`, `ruleId`, `title`, `description`, `redactedEvidence`, and `recommendedAction`. Then add a test that feeds a matching command and asserts the finding (and, where relevant, its severity escalation).

## Adding an MCP rule

MCP config rules live in `MCP_RULES` in `src/core/mcp.ts`. Add an `AAC-MCP-0NN` entry (each mirrors an AsterGuard `AG-*` rule — note which in a comment). Respect the existing conventions:

- The scan reads **JSON** MCP config files only (`mcpServers` / `servers` keys). Codex's TOML (`config.toml`) is deliberately not parsed — don't add a rule that assumes TOML input.
- Reference-only values like `${VAR}` and placeholders are **not** findings (see `AAC-MCP-004`).
- Policy-aware rules (remote-origin `AAC-MCP-005`) read `allowedMcpHosts` from `policy.json`; localhost and allowlisted hosts produce no finding, and plaintext `http://` escalates to high — see how it's threaded through `scanMcpServers` / `src/server/mcp-scan.ts`.

If your rule adds severity, keep it consistent with the posture model (`scoreFindings`: start 100; subtract critical 35 / high 25 / medium 12 / low 5 / info 0; clamp [0,100]; grade A>=90, B>=75, C>=60, D>=40, F<40). Add a test with a fixture MCP config that triggers the rule and one that must **not** (to guard against false positives).

## Before you push

```bash
pnpm test
pnpm typecheck:all
```

Green tests and clean typecheck are the bar. Thanks for keeping it honest.
