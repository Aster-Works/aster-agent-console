# REFACTOR_PLAN — Aster Agent Console → Aster Agent Audit

Status: living document. Phase 0 audit completed 2026-07-11 (6 parallel subsystem
audits + a live-environment gap audit). Decisions recorded here are binding unless
superseded by a later dated entry.

Guiding priorities, in order (from the master brief):
**data safety → backward compatibility → security honesty → correctness →
maintainability → UX → commercial extensibility → visual polish.**

---

## 1. Current architecture map (Phase 0 findings)

### 1.1 Data flow (verified against code, file:line cited)

```
Claude Code hooks (5 entries in ~/.claude/settings.json, absolute paths)
  └─ node ~/.aster-agent-console/hooks/claude-code-hook.mjs
       ├─ POST http://127.0.0.1:48321/events        (collector up)
       └─ append spool/spool.jsonl, REDACTED         (collector down)  [script.ts:43-49]

Codex rollout logs (~/.codex/sessions/**/rollout-*.jsonl)
  └─ polling importer, 5s interval                    [server/codex-import.ts]
       cursor: ~/.aster-agent-console/codex-import.json (absolute paths → {lines, mtime})

POST /events → ingest(agent, payload)                 [server/collector.ts]
  → normalizeHookEvent (redactJson BEFORE storage)    [core/normalize.ts:160,232]
  → risk detection                                    [core/risk.ts]
  → SQLite insert                                     [db/index.ts]
  → recomputeSession, enrichment (git/test/usage)     [server/enrich*, db updates]
  → SSE /api/live → dashboard

Dashboard (Vite+React SPA, HashRouter, 8 routes)
  zustand store holds the ENTIRE dataset in memory; client-side re-aggregation
  on every filter change [web/data/filter.ts]; demo/live switch [web/data/source.ts]
```

Server hardening that already exists (keep): binds 127.0.0.1 only, `MAX_BODY = 512KB`,
Host-header guard against DNS rebinding [server/index.ts:117-122].

### 1.2 Storage (db/index.ts, 653 lines, single module)

- 4 tables: `sessions` (24 cols), `events` (20), `risk_findings` (15), `file_changes` (11);
  4 indexes (session_id ×3, events.type). **No index on** risk_findings.status,
  sessions.started_at, file_changes.timestamp — all used as predicates.
- **No migration system.** Idempotent `create table if not exists` + one hand-rolled
  `PRAGMA table_info(sessions)` probe that ALTERs 4 columns in [db/index.ts:128-136].
- **Append-only violations today** (must be preserved or wrapped, not "fixed" silently):
  - `enrichEvent()` UPDATEs events.links/metrics/title [db/index.ts:315-326]
  - `setRiskStatus()` UPDATEs risk_findings.status, no history [339-353]
  - `updateFileChangeStats()`, `updateSessionUsage()`, `recomputeSession()` UPDATEs
  - `deleteSupersededFileChanges()` DELETEs dedup rows [328-337]
  - retention `pruneOlderThan()` DELETEs across all 4 tables [508-527]
- `foreign_keys=ON` is set but **no FK constraints are declared** — currently a no-op.
- risk_findings.id is composite `${sessionId}:${finding.id}` [db/index.ts:226].
- JSON columns are opaque TEXT; `json()` row helper parses **without try/catch** [597].
- **No DB backup mechanism exists.** The only `backup()` in the repo backs up
  *hook config files* (settings.json / config.toml), not the database.

### 1.3 Rules engines (two, non-overlapping)

- `core/risk.ts` — runtime event rules, ids `AAC-SHELL-*`, `AAC-GIT-*`, `AAC-SECRET-*`,
  `AAC-FILE-*`; persisted findings with an open/acknowledged/resolved lifecycle
  (status UPDATE only, no transition history, no rule versioning).
- `core/mcp.ts` — static MCP config scan, ids `AAC-MCP-001..009`, **stateless**
  (re-derived per scan, never persisted); **JSON configs only** — Codex's
  `~/.codex/config.toml` is NOT scanned today.

### 1.4 CLI (9 commands, commander)

`dashboard, serve, init, doctor, scan, service install/status/uninstall,
hooks install/uninstall/status`. **No `--json` flag anywhere.** Exit codes exist for
`scan --fail-on` only. Version stamped via tsup `define: __AAC_VERSION__` — the one
clean seam (single source of truth, package.json → binary).

### 1.5 Naming inventory (rename surface)

| Name | Where | Count |
|---|---|---|
| `Aster Agent Console` | README, docs, UI title, Sidebar, i18n, CHANGELOG | 14 files |
| `aster-agent` (bin) | package.json bin, help text, docs examples, issue templates | 25 files |
| `.aster-agent-console` (data dir) | db/index.ts:20 (canonical) **+ a second literal in server/codex-import.ts:27** + hook script SPOOL_DIR [script.ts:19] | 13 files |
| `com.asterworks.agent-console` | launchd LABEL [cli/commands/service.ts:14] | 1 + test |
| Fence markers `# >>> aster-agent-console (managed) >>>` | hook installer [installer.ts:20-23] | uninstall depends on them |
| `AAC-*` rule ids | risk.ts, mcp.ts, docs, policy ignoreRules | 6 files |
| GitHub `Aster-Works/aster-agent-console` | package.json repository/homepage/bugs, README (8 URLs incl. issue #1), .github/ISSUE_TEMPLATE | — |

Tests that assert the old literals (must move in lockstep): `tests/hooks.test.ts:67`,
`tests/retention.test.ts:33`. **There is no CI**, so nothing catches a desync.

### 1.6 LIVE environment state (author's machine, 2026-07-11 — decisive for migration design)

1. **The collector is DOWN and has been for ~3 days.** No launchd plist installed,
   port 48321 unbound. DB last written Jul 8. Hooks are live and firing:
   `spool/spool.jsonl` = **55 MB / 19,713 un-ingested events**, last write seconds
   before the audit. The spool fallback is the only thing holding data.
   → Migration must treat the spool as **live payload, not a code path**.
2. Codex hook exists on disk but is **not wired** into `~/.codex/config.toml`;
   the polling importer is the only live Codex path.
3. `codex-import.json` is a **stateful dedupe cursor keyed by absolute paths** —
   losing it re-imports every Codex session (duplicates).
4. `config.json` contains an **absolute `dbPath`** into the old dir — renaming
   the dir without rewriting this leaves the config pointing at the old DB.
5. No `policy.json` exists on disk (defaults-only).
6. `backups/` holds the user's own dotfile snapshots (settings.json / config.toml
   .bak) — restore-on-uninstall depends on this dir and the fence markers.
7. 5 live hook entries in `~/.claude/settings.json`, all absolute paths into the
   old dir. A dir rename does not rewrite them.
8. DB 53 MB + spool 55 MB → copy-based migration needs ~110 MB headroom.

### 1.7 Technical debt register

- `docs/release.md` stale (says 76 tests / v0.1.0 / private-gate pending).
- `tests/enrich.test.ts:72` flaky under 5s timeout (observed 1 timeout / 2 runs).
- `toCsv()` in Settings.tsx lacks CSV-formula-injection neutralization (`= + - @`).
- **No test covers "no raw secret in export"** at the export boundary (only at
  DB-write time, tests/collector.test.ts:65).
- Zero web-layer route/component tests; no i18n key-coverage test.
- `installer.ts` (the load-bearing backup/restore logic) has zero direct tests.
- Client-side aggregation recomputes overview from raw rows per keystroke.
- `aster-agent --version` fixed in 0.1.17; `doctor` still says Codex "hook installed"
  though Codex is rollout-read.

---

## 2. Target architecture

Monorepo split (apps/ + packages/) is **rejected for now** — 12k LOC does not
justify it; the master brief allows a smaller shape. Instead: enforce boundaries
*inside* `src/` with explicit barrel modules, so a later package split is mechanical.

```
src/
  core/
    branding.ts        ← NEW: every product name/path/label constant (single source)
    types.ts           ← canonical event schema evolves here (schemaVersion)
    adapters/          ← NEW (Phase 2): AgentAdapter interface; claude-code + codex impls
    rules/             ← NEW (Phase 2): rules registry, AAA-* ids + legacyIds: AAC-*
    integrity/         ← NEW (Phase 3): canonical serialization, hash chain, verify
    policy.ts          ← NEW (Phase 2): policy schema v1 + precedence + validation
  db/                  ← + user_version migrations, integrity columns
  server/              ← collector, importers, reporting endpoints
  cli/                 ← aster-audit (+ aster-agent alias), migrate, verify, report
  reporting/           ← NEW (Phase 5): JSON/CSV (moved from Settings.tsx), SARIF, HTML
  extension/           ← NEW (Phase 6): capability detection + license verify interface
  web/                 ← presentation only; business logic migrates to core/reporting
```

### 2.1 Decisions (with reasons)

| # | Decision | Reason |
|---|---|---|
| D1 | Work on branch `rebrand/aster-agent-audit`; main stays releasable | reversibility; npm/GitHub renames are manual gates |
| D2 | Data dir resolution: use `~/.aster-agent-audit` if it exists, else fall back to `~/.aster-agent-console`; **no automatic copying at startup** | data safety — silent auto-migration of a 53 MB DB + 55 MB live spool is exactly the "大規模に整理した結果読めなくなる" failure the brief forbids |
| D3 | `migrate` is explicit, copy-based (old dir is **never modified** except adding a marker file), idempotent, `--dry-run` first-class | the untouched old dir IS the backup; 110 MB headroom is acceptable |
| D4 | Migration order: **drain awareness first** — migrate copies the spool and cursor forward; it never deletes the old spool | 55 MB / 19.7k events of un-ingested data on the live machine |
| D5 | `migrate` rewrites `config.json`'s absolute `dbPath` and re-points hook entries in `~/.claude/settings.json` (with the existing backup machinery) | otherwise hooks and config silently keep writing to the old dir |
| D6 | Legacy fence markers + legacy launchd label + legacy hook-path detection are **permanently recognized** by uninstall/status/doctor | uninstall must restore configs written by ANY prior version |
| D7 | Dual bin: `aster-audit` + `aster-agent` → same entry; invoked-as detection prints a 2-line stderr notice on the legacy name; behavior identical | brief's non-invasive alias requirement |
| D8 | Rule ids: new `AAA-*` namespace with `legacyIds: ["AAC-*"]`; policy files referencing old ids keep working; findings tables keep old ids in old rows | backward compat for stored findings + user policies |
| D9 | Hash chain = **tamper-evidence, not tamper-proofing**; pre-migration rows are `legacy-unverified` | security honesty (brief §5) |
| D10 | SQLite gains `PRAGMA user_version`-based migrations starting at v1 = current schema; the existing ad-hoc ALTER probe becomes migration v0→v1 | can't add integrity columns safely without one |
| D11 | package.json name → `@asterworks/agent-audit`, version `0.2.0`, **not published from this branch**; old package deprecation is a manual step documented in MIGRATION_AND_RELEASE.md | publishing is irreversible; per-operation approval |
| D12 | No fake feature gates, no fake adapters, no placeholder commands that pretend to succeed | brief §9/§11; unimplemented commands exit non-zero with "not implemented" |
| D13 | Keep Vite/React/Hono/SQLite/commander stack unchanged | brief §8 explicitly forbids fashion-driven moves |
| D14 | TOML parsing via a maintained parser (`smol-toml` — small, actively maintained, no deps) — the ONE new runtime dependency this refactor permits | brief §4.5 forbids regex-TOML; dependency budget otherwise zero |

### 2.2 Migration risks (ranked)

| Risk | Mitigation |
|---|---|
| Breaking the 5 live Claude hook entries → silent collection stop | D2 fallback keeps old dir active until explicit migrate; migrate re-points entries with backup; doctor shows which dir + hook target is live |
| Orphaning the 55 MB spool | migrate copies spool; collector's existing `importSpool` drains it from the resolved dir |
| Losing the codex-import cursor → duplicate events | migrate carries `codex-import.json` verbatim (absolute rollout paths remain valid — they point into `~/.codex`, not our dir) |
| Stale absolute `dbPath` in config.json | migrate rewrites it; resolveDataDir logs when config path ≠ resolved dir |
| launchd label change orphans an installed service | none is installed on the live machine (verified); still: `service install` boots out the legacy label first, `service status/uninstall` checks both |
| Old `hooks uninstall` can't find new fences / new can't find old | recognize both marker sets forever (D6) |
| Tests keep passing against stale names | tests assert NEW literals AND legacy literals for compat paths; CI addition documented as manual step |

---

## 3. Implementation order

- **Phase 1 (this branch, now): Rename Foundation.**
  branding.ts → data-dir resolution + fallback → dual bin + alias notice →
  `migrate` (+ `--dry-run`) → doctor integration → legacy label/fences →
  UI/i18n/docs rename → MIGRATION_AND_RELEASE.md → tests.
- **Phase 2: Core Architecture.** Canonical `AuditEvent` (schemaVersion, source
  adapter triplet), `AgentAdapter` interface wrapping the existing claude-code hook
  path + codex importer (no behavior change), rules registry with `legacyIds`,
  policy schema v1 (validation, precedence user < repo-local, dry-run), reporting
  + integrity + extension interfaces (types + contract tests only where impl waits).
- **Phase 3: Audit Integrity.** user_version migration adding `prev_hash`/`hash`
  to events; deterministic canonical JSON serialization; chain computed at insert;
  `aster-audit verify [--session] [--format json]`; legacy rows → `legacy-unverified`;
  integrity status in doctor + Overview; evidence bundle (canonical JSON, no raw secrets).
- **Phase 4: MCP Security.** TOML+JSON → canonical McpServer model; inventory
  screen (fingerprint, change detection new/removed/changed); findings lifecycle
  extension (acknowledged/accepted-risk/false-positive + append-only status history
  table); `AAA-MCP-*` with legacy mapping.
- **Phase 5: Reporting & CI.** Move export out of Settings.tsx into `reporting/`
  (server-side); SARIF 2.1.0 for scan; print-ready HTML report (no PDF dependency);
  `scan --baseline`; stable exit codes; `--json` on doctor/scan/audit/verify;
  export-boundary secret test + CSV-formula-injection guard.
- **Phase 6: Commercial Readiness.** capability/edition detection, license verify
  interface (public key verify only; no private key, no issuance code in repo),
  docs/community-pro-team.md + commercial-architecture.md + external license-service spec.

Definition of done per the brief §17; every phase lands green
(`pnpm test && pnpm typecheck:all && pnpm build:all`).

---

## 4. Decision log (append-only)

- 2026-07-11: D1–D14 recorded (Phase 0). Live-machine findings §1.6 make D2/D3/D4
  non-negotiable: the spool is live payload; nothing may auto-move it.
- 2026-07-11: Monorepo split rejected at current size; boundaries enforced in-place
  (§2). Revisit if `packages/` consumers appear (Pro extension).
- 2026-07-11: New runtime dependency budget for the whole refactor: exactly one
  (TOML parser, Phase 4). Everything else uses stdlib/node/existing deps.
