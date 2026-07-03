# Changelog

All notable changes to Aster Agent Console are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.1]: https://github.com/Aster-Works/aster-agent-console/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Aster-Works/aster-agent-console/releases/tag/v0.1.0
