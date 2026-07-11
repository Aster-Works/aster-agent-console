# Privacy & Local-First Data Handling

Aster Agent Audit (`@asterworks/agent-audit`, MIT, beta) is a local-first
safety and work-audit dashboard for Claude Code and Codex. Everything it
captures stays on your machine. This document tells a security-conscious
developer exactly what is stored, where, how secrets are handled, and how to
inspect or delete it — with the source file for every claim so you can verify.

> **Beta, honest scope.** Redaction is best-effort defense-in-depth, not a
> guarantee. The MCP scan is static and heuristic, not exhaustive. Treat the
> local database as sensitive and keep it local.

> **Renamed from Aster Agent Console.** The data directory moved from
> `~/.aster-agent-console/` to `~/.aster-agent-audit/`. A fresh install uses
> the new directory immediately; an existing install keeps using the old one
> as-is until you run `aster-audit migrate` — nothing moves automatically. See
> [Migrating from Aster Agent Console](migration-from-agent-console.md).

## TL;DR

- **No cloud upload. No telemetry.** Nothing leaves `127.0.0.1`.
- All data lives in `~/.aster-agent-audit/` (or, on an existing install that
  hasn't migrated yet, `~/.aster-agent-console/`) as a plain SQLite file.
- Secrets are redacted **before** they are written to disk.
- The tool **never executes** any command it captures or scans — commands are
  only ever inspected as text.
- Cloud/team features are **opt-in future work, off by default** — they don't
  exist in this build.
- To delete everything: `rm -rf ~/.aster-agent-audit` (add
  `~/.aster-agent-console` too if you haven't migrated).

## What is captured

Capture happens through agent hooks you install explicitly with
`aster-audit init --install-hooks` or `aster-audit hooks install`. A hook reads
the agent's event from stdin and POSTs `{agent, payload}` to the local
collector (`src/cli/hooks/script.ts`). From your agent sessions this includes:

- Prompts and tool calls
- Shell commands the agent runs
- File paths it reads/writes
- Test results (passed/failed)
- Git events (commits, resets, force pushes, etc.)
- Session metadata: repo path, cwd, model, timestamps

This is a work-audit tool, so **code and prompt text are stored on purpose** —
that's what lets you replay a session. Redaction removes credentials, not your
work. Keep the DB local accordingly.

The database schema (`src/db/index.ts`) is the ground truth for what columns
exist: `sessions`, `events`, `risk_findings`, `file_changes`.

## What is NOT captured

- **No cloud upload by default** — the server binds `127.0.0.1` only and there
  is no outbound upload sink in this build. (Git enrichment shells out to your
  local `git` binary; it makes no network calls to ship your data anywhere.)
- **No telemetry, no analytics, no phone-home.**
- **No raw secrets** — see redaction below.

## Where it lives

Everything is under a single directory
(`DEFAULT_CONFIG_DIR` in `src/db/index.ts`, re-exported by
`src/cli/util/paths.ts`):

```
~/.aster-agent-audit/      # or ~/.aster-agent-console/ on an install that hasn't migrated
├── agent-console.db      # SQLite (better-sqlite3, WAL mode) — filename unchanged by the rename
├── hooks/
├── backups/              # pre-change backups of your agent config files
├── spool/                # redacted-minimal events buffered while collector was offline
└── policy.json           # optional, user-created
```

`DEFAULT_CONFIG_DIR` resolves to `~/.aster-agent-audit/` if it exists, otherwise
to `~/.aster-agent-console/` if that exists, otherwise to `~/.aster-agent-audit/`
(so a brand-new install lands on the new name automatically; an existing
install keeps its data where it is until you run `aster-audit migrate`).

WAL mode means you may also see `agent-console.db-wal` and `agent-console.db-shm`
alongside the main file (`src/db/index.ts`: `journal_mode = WAL`).

## Redaction

Secrets are redacted **before persistence**. The redaction functions live in
`src/core/redaction.ts` and are invoked while an incoming event is normalized
(`redactJson`/`redactString` in `src/core/normalize.ts`), which the collector
(`src/server/collector.ts`) calls before anything is written. What this means
concretely:

- Raw secret values are **never stored** — only a masked replacement, a
  non-reversible FNV-1a fingerprint (for dedupe), the field path, and the kind.
- **Event titles are generated from already-redacted values**, so a title can't
  leak a secret.
- The **spool is redacted-minimal** — while the collector is offline, the hook
  strips secrets from the payload before buffering it
  (`stripSecrets` in `src/cli/hooks/script.ts`), then replays on the next
  `aster-audit dashboard`.
- **Finding evidence is redacted** — every finding carries `redactedEvidence`,
  never a raw secret.

Detected kinds include private keys (RSA/EC/OpenSSH/DSA/PGP), `sk-ant-*` and
`sk-*` API keys, GitHub tokens (`ghp_`/`gho_`/…/`github_pat_`), Supabase keys
(`sbp_`/`sbs_`/`sbsecret_`), JWTs, AWS access key ids (`AKIA…`), `user:pass@`
URL credentials, and `*.env`-style
`KEY=`/`TOKEN=`/`SECRET=`/`PASSWORD=` assignments
(`PATTERNS` and `ENV_ASSIGN` in `src/core/redaction.ts`).

> **Honest limitation.** Redaction is pattern-based best-effort. A secret in an
> unusual format may slip through. It is a defense-in-depth layer, **not a
> guarantee** — combined with the fact that code and prompts are stored by
> design, the right posture is: keep the database on your machine.

## Network posture

The local server (`src/server/index.ts`) is deliberately minimal and inert:

- **Binds `127.0.0.1:48321` only** (`HOST`/`PORT` constants).
- **Host-header guard** — non-local `Host` headers get `403`, defense in depth
  against DNS rebinding.
- **JSON only** — non-`application/json` bodies get `415`.
- **Size-limited** — bodies over 512 KB get `413`.
- **Never executes incoming commands** — the collector normalizes, redacts,
  scores risk, persists, and broadcasts. Captured commands are treated purely as
  text.

Verify it's local:

```bash
aster-audit doctor
curl -s http://127.0.0.1:48321/health
```

## MCP config scan is read-only

`aster-audit scan [dir]` discovers MCP config files and inspects them
(`src/core/mcp.ts`, `src/server/mcp-scan.ts`). Only **JSON** MCP configs are
discovered (Claude, Cursor, VS Code, Windsurf, Cline, Gemini); Codex's
`config.toml` is **not parsed** and is explicitly deferred, matching AsterGuard.
These files are **read only, never executed**. Findings carry
`severity, category, ruleId, title, description, redactedEvidence,
recommendedAction` — evidence is redacted, and any command strings are inspected
as text only.

`policy.json` can silence noise for hosts/rules you've vetted, but it **only
filters what the Risk Radar displays — it never changes what is collected. The
DB keeps the honest record** (`src/core/policy.ts`).

## Hook safety

Installing hooks edits your agent config, so the installer
(`src/cli/hooks/installer.ts`) is conservative:

- **Always backs up first** to `backups/` inside your active data directory
  (`~/.aster-agent-audit/backups/`, or `~/.aster-agent-console/backups/` on an
  install that hasn't migrated) before any change.
- **Merges, doesn't clobber** — Claude Code hooks merge into `settings.json`
  (existing hooks preserved); Codex uses a fenced insert into `config.toml`
  `notify` (any existing `notify` is commented out, reversibly).
- **`uninstall` fully restores from backup.**
- The hook script is **non-blocking and always exits 0** — it never executes
  commands and never stalls your agent, even if the collector is down
  (`src/cli/hooks/script.ts`).

Preview before touching anything:

```bash
aster-audit init --dry-run
aster-audit hooks status
```

Remove cleanly:

```bash
aster-audit hooks uninstall
```

## Inspect and delete your data

The database is a plain SQLite file — no proprietary format, no lock-in.
Inspect it directly (swap in `~/.aster-agent-console/` if you haven't migrated):

```bash
sqlite3 ~/.aster-agent-audit/agent-console.db '.tables'
sqlite3 ~/.aster-agent-audit/agent-console.db 'select id, agent, type, title from events limit 20;'
```

Delete a single session, the whole DB, or everything:

```bash
# nuke the database only
rm -f ~/.aster-agent-audit/agent-console.db*

# nuke everything (db, spool, backups, hooks, policy)
rm -rf ~/.aster-agent-audit

# and, if you haven't migrated and want the legacy data gone too:
rm -rf ~/.aster-agent-console
```

Point the tool at an alternate DB (e.g. a throwaway) with `--db`:

```bash
aster-audit dashboard --db /tmp/scratch.db
```

## Cloud & team features

There are none in this build. Any cloud sync or team sharing is **opt-in future
work and off by default** — this beta collects locally and stays local. If and
when such features ship, they will be explicit opt-in, and this document will
say so.
