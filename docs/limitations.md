# Known Limitations

Aster Agent Audit (`@asterworks/agent-audit`) is a **beta**, local-first safety and work-audit console for Claude Code and Codex. It is intentionally honest about what it does *not* do. Read this before you rely on it for anything security-critical.

None of the limitations below are bugs — they are the current, deliberate boundaries of the tool.

## MCP scan is JSON-only — Codex TOML is not scanned

`aster-audit scan` discovers and reads **JSON** MCP config files only:

```bash
aster-audit scan            # scans the current directory + user-level configs
aster-audit scan ./my-repo  # scans a specific project directory
```

Discovered sources: Claude (`~/.claude.json`, project `.mcp.json`), Cursor (`~/.cursor/mcp.json`, `.cursor/mcp.json`), VS Code (`.vscode/mcp.json`, `servers` key), Windsurf (`~/.codeium/windsurf/mcp_config.json`), Cline (VS Code `globalStorage` `cline_mcp_settings.json`), and Gemini (`~/.gemini/settings.json`).

**Codex uses TOML (`~/.codex/config.toml`), which is NOT parsed.** MCP servers defined there are not scanned. This is deferred, not silently dropped — AsterGuard does not parse it either. If your MCP servers live only in `config.toml`, the scan will not see them.

## The MCP scan is static and heuristic — not a sandbox

The scan is pattern-based text analysis (`src/core/mcp.ts` rules `AAC-MCP-001` … `AAC-MCP-009`). It reads config **as text and never executes anything**. As a result:

- It can produce **false positives** (flagging a harmless command that matches a pattern) and **false negatives** (missing a real risk that does not match a known pattern).
- A clean scan — even an **A** posture grade — does **not prove** a server is safe. It means nothing matched the current ruleset.
- Runtime behavior (what a server actually does when invoked) is out of scope. There is no dynamic analysis or sandboxing.

`redactedEvidence` in a finding is exactly that — redacted. Treat grades and findings as a triage aid, not a security certification.

## Permissions in the MCP map are inferred

The permission tags shown per server (`inferPermissions` in `src/core/mcp.ts`) are **inferred from the command/args text**, not read from an authoritative capability manifest. A server may do more or less than its inferred permissions suggest. Use them as a hint, not a contract.

## Redaction is best-effort, not a guarantee

Secrets are redacted **before** anything is written to disk (`src/core/redaction.ts`), and spooled events are redacted-minimal. This is defense-in-depth, not a guarantee. Redaction is pattern-based, so a novel secret format could slip through. Do not treat the local database as safe to publish.

## Events come from hooks; token counts come from transcripts

The console's event stream — sessions, prompts, tool calls, tests, git — comes only through installed **hooks** (`src/cli/hooks/*`). The one exception is **token counts**, which no hook exposes; those are read (numbers only) from each agent's transcript — see "Token counts … cost is an estimate" below.

```bash
aster-audit hooks status              # is anything installed?
aster-audit hooks install --dry-run   # preview the changes
aster-audit init --install-hooks -y   # set up local files + install hooks
```

Consequences:

- **Without hooks installed, you see demo data only.** The dashboard ships deterministic demo data (with a demo/live toggle in the top bar) so the UI works before setup — but it is not your activity.
- **Hook payload formats may change across agent versions.** Claude Code and Codex can change what they send; a format the parser does not recognize may be recorded thinly or not at all.
- Hooks never block the agent and never execute commands (short timeout, always exit 0). If the collector is offline, events are spooled redacted-minimal and replayed on the next `aster-audit dashboard`.

## Token counts are read from transcripts; cost is an estimate

Hook payloads carry no token usage, so token counts are read directly from each agent's transcript — **numbers only. No prompt or response content is ever read into the console, forwarded, or stored** (`src/server/usage.ts`). This runs on the local collector as opt-in enrichment.

- **Cost is an estimate.** It is token counts × a small, editable rate table (`PRICING` in `src/server/usage.ts`) and is labeled *estimated* in the UI. Published prices change — treat the figure as approximate and edit the table if you need accuracy. The token counts themselves are exact.
- **Transcript formats are internal and may change.** Claude Code (`~/.claude/projects/*.jsonl`) and Codex (`~/.codex/sessions/**/rollout-*.jsonl`) can change their formats at any release; a missing or renamed field degrades to 0 (token/cost simply don't appear) while everything else keeps working.
- **Codex mapping is best-effort.** Codex's `notify` payload is minimal, so its rollout file is located by session id or by matching working directory and recency. If it can't be matched, Codex token/cost show nothing.

## Only Claude Code and Codex activity is collected

The MCP scan **discovers** configs for Cursor, VS Code, Windsurf, Cline, and Gemini — but collector hooks are only installed for **Claude Code and Codex**. The other agents' *activity* (sessions, edits, commands) is **not** collected. You get a security scan of their MCP configs, nothing more.

## Working-tree edit line counts start at 0

Line counts for uncommitted (working-tree) edits are **0 until git enrichment attributes them** (`src/server/enrich.ts`, `src/server/git.ts`). Enrichment runs asynchronously after ingest, and committed rows supersede working-tree rows for the same files. Expect a brief window — and any never-committed edit — to show 0 added/deleted lines.

## No cloud, no team, no auth, no billing

This is a single-user, local MVP:

- The server binds `127.0.0.1:48321` **only**, with a host-header guard against DNS rebinding, accepts JSON, caps bodies at 512KB, and **never executes incoming commands** (`src/server/index.ts`).
- All data stays in `~/.aster-agent-audit/` (SQLite via `better-sqlite3`, WAL mode). History is retained for **30 days** and older rows are pruned automatically, so the local database stays bounded (and old activity is not kept forever).
- There is **no cloud sync, no shared/team dashboard, no authentication, and no billing.** Each machine is its own island.

## Policy filters the view, not the record

`~/.aster-agent-audit/policy.json` (`allowedMcpHosts`, `ignoreRules`, `failOn`) changes what the Risk Radar displays and what exit code `aster-audit scan` returns — but it **never changes what is collected**. The database keeps the honest, unfiltered record. Silencing a rule in policy hides it from the UI; it does not make the underlying finding go away.
