# Troubleshooting

Practical fixes for the most common issues. Each item is **symptom → cause → fix**.

Aster Agent Audit is local-first and in beta. Everything runs on `127.0.0.1:48321`; nothing is sent to the cloud, and your data lives in `~/.aster-agent-audit/`.

If you installed the published beta, use `aster-audit` (from `npm install -g @asterworks/agent-audit`) or prefix commands with `npx @asterworks/agent-audit`.

A good first move for almost any problem is:

```bash
aster-audit doctor
```

It checks your Node version, storage, collector health, hook status, and MCP posture in one pass.

---

## No data / only demo data showing

**Symptom:** The dashboard loads but shows the same sample sessions every time, and the top-bar toggle sits on **Demo**.

**Cause:** One of two things:
- Hooks aren't installed, so no real agent activity is being collected, **or**
- The database is empty. When **Live** mode finds no events, the UI deliberately falls back to demo data so the screens still render. This fallback is expected, not a bug.

**Fix:** Install the collector hooks, then switch the top-bar toggle to **Live**.

```bash
aster-audit init --install-hooks
```

Your existing agent config is backed up first. After the hooks fire on your next Claude Code / Codex activity, live data appears. Until then, demo mode is the intended experience.

To confirm hooks are actually wired in:

```bash
aster-audit hooks status
```

---

## Port 48321 already in use

**Symptom:** `aster-audit dashboard` prints `Could not start the local server on 127.0.0.1:48321` and suggests another instance may be running.

**Cause:** The fixed collector port (`48321`) is taken — usually another `aster-audit dashboard` already running, or an unrelated process on that port.

**Fix:** Point the dashboard at a different port:

```bash
aster-audit dashboard --port 48322
```

Note that hooks POST to the default port, so a non-default port is best for a quick look at existing data rather than live collection. If you just want to reclaim the default, stop the other instance (Ctrl+C in its terminal) and rerun `aster-audit dashboard`.

---

## `doctor` says the local server is not running

**Symptom:** `aster-audit doctor` reports `Local server · not running`.

**Cause:** `doctor` only probes `http://127.0.0.1:48321/health`. If no dashboard is up, there's nothing to answer — this is informational, not an error.

**Fix:** Start the collector in another terminal and leave it running:

```bash
aster-audit dashboard
```

If your dashboard runs on a custom port, tell `doctor` where to look:

```bash
aster-audit doctor --port 48322
```

---

## Hooks not firing

**Symptom:** Hooks report as installed but no live events show up.

**Cause / Fix:** Work through these in order.

1. **Confirm what's actually installed and where:**

   ```bash
   aster-audit hooks status
   ```

   It reports each agent as *installed* (with the config path), *detected · not installed*, or *not detected*.

2. **Claude Code — user vs. project config.** The hook is merged into a `settings.json` `hooks` block (existing hooks are preserved). Detection covers, in order:
   - `~/.claude/settings.json` (user)
   - `./.claude/settings.json` (project)
   - `./.claude/settings.local.json` (project)

   The installer writes to the first of these that already exists (falling back to the user file). If your agent reads a project-scoped file but the hook landed in your user file (or vice-versa), events won't flow for that project. Rerun the install from the project directory so the right config is targeted.

3. **Codex — `config.toml` notify.** The Codex hook is a fenced block appended to `~/.codex/config.toml` that sets `notify` to the console's hook script. Any pre-existing top-level `notify` line is commented out in place (prefixed `# [aster-agent] disabled:`) so ours takes effect; `hooks uninstall` restores it. Confirm the managed fence is present:

   ```bash
   grep -n "aster-agent-audit" ~/.codex/config.toml
   ```

4. **Is the collector reachable?** Hooks POST to the running dashboard. If the collector is offline when an event fires, the hook doesn't fail or block your agent — it appends a redacted-minimal event to the spool (`~/.aster-agent-audit/spool/`). Those are replayed automatically the next time you run:

   ```bash
   aster-audit dashboard
   ```

   Watch for the `Imported spool` line at startup — that's your buffered events arriving.

5. Hooks are intentionally quiet: short timeout, never execute commands, always exit 0. They will not surface errors in your agent, so use `hooks status` and the spool to diagnose rather than expecting console noise.

---

## Where is my data?

Everything lives under:

```
~/.aster-agent-audit/
├── agent-console.db     # SQLite (WAL mode) — the honest record of collected events
├── hooks/               # generated per-agent hook scripts
├── backups/             # timestamped backups of agent config, made before every change
├── spool/               # redacted-minimal events buffered while the collector was offline
└── policy.json          # optional, user-created (see below)
```

Secrets are redacted **before** storage, so the DB is not meant to hold raw secrets. Redaction is best-effort, pattern-based defense-in-depth, not a guarantee — treat the database as sensitive local data regardless. `policy.json` can filter what the Risk Radar displays, but it never changes what's collected: the database keeps the full, honest record.

---

## How do I remove everything?

**Symptom:** You want to fully uninstall — restore your agent config and delete all local data.

**Fix:** Remove the hooks first (this restores each agent's original config from backup), then delete the data directory:

```bash
aster-audit hooks uninstall
rm -rf ~/.aster-agent-audit
```

If you installed the CLI globally, also:

```bash
npm uninstall -g @asterworks/agent-audit
```

`hooks uninstall` backs up before it changes anything and removes the managed hook from your `settings.json` / `config.toml`, so your config returns to its prior state (and a fresh backup is kept if you need to inspect it).

---

## `scan` finds nothing

**Symptom:** `aster-audit scan` prints `No MCP config files found under … or your home directory.`

**Cause:** The scanner only discovers **JSON** MCP config files. If you have none in the scanned locations — or your only MCP config is Codex's `config.toml` — there's nothing to report.

**Fix:** Confirm you actually have a JSON MCP config in a location the scanner checks:
- Claude: `~/.claude.json`, project `.mcp.json` (also `.claude/settings.json` / `.claude/settings.local.json`)
- Cursor: `~/.cursor/mcp.json`, project `.cursor/mcp.json`
- VS Code: `.vscode/mcp.json` (`servers` key)
- Windsurf: `~/.codeium/windsurf/mcp_config.json`
- Cline: VS Code globalStorage `cline_mcp_settings.json`
- Gemini: `~/.gemini/settings.json`

The scanner reads `mcpServers` or `servers` keys. Point it at the right directory if your project config is elsewhere:

```bash
aster-audit scan ~/path/to/project
```

**Codex `config.toml` is TOML, which is not supported and is explicitly deferred** — this is by design (AsterGuard doesn't parse it either), not a scan failure. A clean result on a Codex-only setup is expected.

The scan is static and heuristic — it inspects config as text and never executes anything. It is not exhaustive.

---

## Node version errors / `aster-audit` won't run

**Symptom:** The CLI crashes on startup, or `doctor` flags `Node.js ≥ 20`.

**Cause:** Aster Agent Audit requires **Node 20+** and is ESM-only.

**Fix:** Upgrade Node to 20 or newer, then verify:

```bash
node --version   # must be v20.x or higher
aster-audit doctor
```

---

## For contributors: `corepack pnpm` signature-key failure

**Symptom:** On some machines, `corepack pnpm install` fails during signature-key verification.

> This section is for people building from source. End users on the published beta don't need pnpm at all.

**Cause:** A Corepack signature-verification quirk against the pinned pnpm version.

**Fix:** Either disable Corepack's latest-key behavior:

```bash
COREPACK_DEFAULT_TO_LATEST=0 pnpm install
```

…or bypass the package-manager wrapper and call the binaries directly:

```bash
./node_modules/.bin/vitest      # tests
./node_modules/.bin/tsc         # typecheck
./node_modules/.bin/vite        # dev / build
./node_modules/.bin/tsup        # CLI build
```
