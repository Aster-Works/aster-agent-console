# Changelog

All notable changes to Aster Agent Console are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.15] — 2026-07-04

### Changed

- **Repositioning (docs).** The README, Japanese guide, and npm description now
  lead with what's distinctive: the one **local-first, no-account** console that
  unifies safety + work-audit + **MCP security** across **both Claude Code and
  Codex** — versus cost-only CLIs and account/cloud security scanners.
- Added a **Sponsor** button (`FUNDING.yml`) and a **Pro/Team interest** thread
  (#1) to gauge demand for an optional team tier. No behavior change.

## [0.1.14] — 2026-07-04

### Added

- **Japanese UI with a language switch.** The whole dashboard is now localizable:
  an **EN / 日本語** toggle in the top bar switches the interface instantly, and
  the choice is remembered (the first run follows your browser language). Brand
  names, commands, model names, file paths, and collected data stay as-is.
- **Japanese README.** A 日本語ガイド section is appended to the README, shown on
  both GitHub and npm.

## [0.1.13] — 2026-07-04

### Fixed

- **Risk Radar findings list no longer leaves a large empty scroll area.** The
  findings panel sized itself to its tall neighbours and left dead space below
  the list; it now sizes to its own content.
- **Rotate-the-key links now actually appear.** The provider is resolved from the
  MCP server name a finding records (e.g. `magic` → 21st.dev), from a database
  connection string's host (Supabase / Neon / RDS, or clear local-DB guidance
  when there's no web page to rotate), and from more token prefixes (Anthropic,
  GitHub, Supabase, OpenAI, AWS, Google, Stripe, Slack).

## [0.1.12] — 2026-07-04

### Changed

- **Risk Radar actions are now honest about secrets.** The console redacts
  secrets before storing them, so a finding's record never holds the raw key —
  the real value lives in the agent's own logs and its source config. So:
  - **Removed "Delete record"** and **"Ignore this rule."** Deleting an
    already-redacted audit record does not remove an exposed secret, so offering
    it was misleading.
  - **Resolve now marks a finding handled instead of hiding it.** A resolved
    finding stays in the list — struck through, badged "Resolved", and out of the
    active safety score — with **Reopen** to undo. Findings are never deleted;
    the honest audit record is kept.

### Added

- **Rotate-the-key guidance on secret findings.** Each secret finding now spells
  out that the raw value still sits in plaintext in the agent's log (and wherever
  it came from), that deleting a record wouldn't undo the exposure, and links to
  where to **rotate the key** — Anthropic, GitHub, Supabase, OpenAI, or AWS, with
  a generic pointer otherwise. Rotation is the only real fix.

## [0.1.11] — 2026-07-04

### Added

- **Act on findings from the Risk Radar.** Each finding now has actions in its
  detail panel:
  - **Resolve** — dismiss a reviewed finding; it drops off the radar (and the
    safety score recovers) while the underlying record stays in Session Replay.
  - **Delete record** — permanently remove the finding *and* purge the captured
    event it came from (event + its findings + file changes) — e.g. deleting a
    "secret detected" record entirely. Confirmation required.
  - **Ignore this rule** — mute a whole rule via `policy.json` so all of its
    findings stop surfacing. This is the way to clear MCP config-scan findings
    (e.g. a hardcoded key in a server env), which reflect current configuration
    and have no stored record to delete. Undo by editing `policy.json`.

## [0.1.10] — 2026-07-04

### Added

- **Codex activity is now collected in full.** Codex has no per-tool hook, so its
  work is read directly from its rollout session logs (`~/.codex/sessions`) —
  commands, exit codes, patched files, MCP calls, and token/cost — through the
  same redaction, risk detection, and enrichment pipeline as Claude Code. No
  configuration change is required, and it no longer touches Codex's single
  `notify` slot, so other consumers (e.g. Codex Computer Use) keep working.
- **Five more Insights statistics**, all filter-aware: tool **latency** (per-tool
  median / p90 execution time, plus prompt-to-first-action "thinking time"),
  **command failure rate**, **file-type breakdown** by extension, **daily
  cost/token trend** (last 30 days), and **session outcomes** (completed / failed
  / interrupted).
- **Settings is now live and configurable.** Real per-agent collection status and
  live diagnostics, the actual active detection rules, editable and persisted
  **data retention** and **cost-estimate rates**, and working **Export** (work
  report JSON, findings CSV).

### Fixed

- **Redaction now catches lowercase and mixed-case secret assignments** (e.g.
  `api_key=…`, `database_password=…`), not only all-uppercase keys — important now
  that captured shell output is ingested.
- Codex hook setup now **repairs** a legacy managed `notify` block instead of
  hijacking Codex's `notify`.
- Stat-correctness fixes: tool-latency pairing no longer desyncs when an explicit
  duration is present, and the command-failure rate counts real command runs only
  (a red test suite is no longer scored as a broken command).

### Changed

- Codex integration switched from the `notify` hook to automatic rollout-log
  reading (see Added). `aster-agent init` requires no Codex config change.

## [0.1.9] — 2026-07-04

### Added

- **Insights screen.** A new page with five statistics, all filter-aware:
  token composition (uncached input / cache read / output / cache write) with a
  **cache-hit-rate** gauge, **cost efficiency** ($ per commit / file / session,
  tokens per tool call), **tool-usage distribution**, **risk-interception rate**
  (flagged share of tool calls), and **cost by model**.
- Session token **breakdown** (input / output / cache-read / cache-write) is now
  persisted (new columns, auto-migrated on existing databases) to power the
  token-composition and cache-hit-rate views.

## [0.1.8] — 2026-07-04

### Changed

- **Sparklines are now real.** Per-agent activity sparklines (Overview KPIs,
  Sidebar, Agents) are derived from actual event timestamps instead of seeded
  placeholder noise.
- **Top-bar filters now work.** Agent / repo / date-range / search filter every
  screen by re-aggregating the real data client-side (they were previously
  decorative). The repo dropdown lists the repos actually present in your data,
  and the date range defaults to the last 7 days.
- **The background collector is installed by default** with `aster-agent init
  --install-hooks` (macOS; opt out with `--no-service`), so continuous
  collection is on out of the box.

## [0.1.7] — 2026-07-03

### Fixed

- The Codex token/cost lookup now resolves a session's rollout file **at most
  once** (the "not found" result is cached too), instead of re-scanning
  `~/.codex/sessions` on every Codex event.

## [0.1.6] — 2026-07-03

### Added

- **Background collector service.** `aster-agent service install` runs the
  collector continuously via macOS launchd (starts at login, restarts on crash),
  so activity is collected even when no dashboard is open. `aster-agent dashboard`
  now reuses a running collector instead of starting a second one, and a headless
  `aster-agent serve` is available for any supervisor.
- **30-day retention.** The collector prunes history older than 30 days on
  startup and every 12 hours, keeping the local database bounded.

### Changed

- Overview KPI footnotes now come from real data (risk-severity breakdown, top
  tools, high-churn files, PR drafts) instead of fixed demo strings, and the
  placeholder trend percentages were removed.

## [0.1.5] — 2026-07-03

### Changed

- The Overview's radar panel is now the same **Safety Surface** as the Risk Radar
  page — a full green shape when safe, dipping inward where findings are, with an
  inline safety score and grade. (Safety scoring is now shared in `lib/safety.ts`.)

### Fixed

- **Times now display in your local timezone** (auto-detected). Event clocks and
  the Live Activity chart previously showed the raw ISO wall-clock, so live events
  (stored in UTC) appeared in UTC instead of, e.g., JST.

## [0.1.4] — 2026-07-03

### Added

- **Token & cost tracking.** The Overview KPIs and the Agents comparison now
  show token usage and an estimated cost per agent for Claude Code and Codex.
  Token counts are read **numbers-only** from each agent's transcript
  (`~/.claude/projects/*.jsonl`, `~/.codex/sessions/**/rollout-*.jsonl`) — no
  prompt or response content is ever read into the console, forwarded, or
  stored. Cost is an estimate from an editable rate table; token counts are
  exact. Transcript formats are internal and degrade gracefully to 0 if they
  change, and Codex mapping is best-effort. See `docs/limitations.md`.

## [0.1.3] — 2026-07-03

### Changed

- Risk Radar's "Risk Surface" is now a **Safety Surface**: an overall safety
  score (0–100, A–F) plus a radar that reads as a full green hexagon when you're
  safe and dips inward — amber or red — where findings are. Shows "All clear"
  with a green badge when no risks are detected, so a clean run feels rewarding
  instead of empty.

## [0.1.2] — 2026-07-03

### Fixed

- The dashboard now **auto-detects the local collector on startup** and shows
  your real agent activity (live) instead of demo data. Previously it stayed on
  demo until you manually flipped the Demo→Live toggle, so installed users saw
  only demo data even with their own sessions collected. New events stream in
  live via SSE, and an offline collector cleanly falls back to demo.

## [0.1.1] — 2026-07-03

### Documentation

- README now embeds a product-tour GIF and per-screen screenshots (demo data).
- No functional changes to the collector, CLI, or scanner.

## [0.1.0] — 2026-07-03

First public beta (Phases 1–6).

### Added

- **Local dashboard** (Phase 1) — Vite + React + TypeScript cockpit with six
  screens (Overview, Session Replay, Repo Activity, Risk Radar, Agents,
  Settings) and deterministic demo data so the UI works before any setup.
- **Local collector + SQLite** (Phase 2) — `POST /events`, event
  normalization, secret redaction before storage, risk detection, and an SSE
  live stream. The server binds to `127.0.0.1:48321` only and never executes
  incoming commands.
- **CLI** (Phase 3) — `aster-agent dashboard`, `doctor`, and
  `init` (with `--dry-run` / `--install-hooks`).
- **Claude Code + Codex hooks** (Phase 4) — detect and back up existing config,
  install a collector hook, spool events when the collector is offline, and
  replay them on the next dashboard start. Hooks never block the agent and
  fully restore on uninstall.
- **Git & test enrichment** (Phase 5) — real changed-file stats, commit
  association, and test-result classification, computed off the request path.
- **AsterGuard integration** (Phase 6) — `aster-agent scan` scans local MCP
  configuration for security risks via nine `AAC-MCP-*` rules that mirror
  AsterGuard's `AG-*` detections, an A–F posture grade, and a
  `policy.json` (`allowedMcpHosts`, `ignoreRules`, `failOn`). MCP findings feed
  the Risk Radar; `doctor` reports MCP posture.

### Security

- Secrets are redacted before they reach the database; finding evidence is
  redacted and commands are only inspected as text, never executed.
- The local server enforces a host-header guard, a JSON-only content type, and
  a request-body size limit.

[0.1.9]: https://github.com/Aster-Works/aster-agent-console/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/Aster-Works/aster-agent-console/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/Aster-Works/aster-agent-console/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Aster-Works/aster-agent-console/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Aster-Works/aster-agent-console/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Aster-Works/aster-agent-console/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Aster-Works/aster-agent-console/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Aster-Works/aster-agent-console/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Aster-Works/aster-agent-console/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Aster-Works/aster-agent-console/releases/tag/v0.1.0
