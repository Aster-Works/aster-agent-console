# Quickstart (5 minutes)

Aster Agent Audit is a **local-first safety, work-audit, and outcome dashboard** for Claude Code and Codex. It runs entirely on your machine, binds to `127.0.0.1` only, and never executes any command it collects — it inspects commands as text. This is a beta: redaction is best-effort defense-in-depth, and the MCP scan is static and heuristic, not exhaustive.

This guide takes you from install to real data in under five minutes.

## 1. Install

Global install:

```bash
npm install -g @asterworks/agent-audit
aster-audit --help
```

Or run without installing:

```bash
npx @asterworks/agent-audit dashboard
```

Requires Node.js ≥ 20. All examples below use the `aster-audit` binary; prefix with `npx @asterworks/agent-audit` if you skipped the global install.

## 2. First look (works immediately, no setup)

```bash
aster-audit dashboard
```

This starts the local server on `http://127.0.0.1:48321` and opens it in your browser. The UI ships with **deterministic demo data**, so every screen — Overview, Session Replay, Repo Activity, Risk Radar, Agents, Settings — is populated before you've wired up anything.

A **demo/live toggle** sits in the top bar. Leave it on **Demo** to explore the tool; switch to **Live** once you've collected your own activity (step 3). Agents are color-coded: Claude Code green, Codex cyan.

Add `--no-open` to skip launching the browser, or `-p <port>` to bind a different port.

## 3. Collect real activity

First, detect your agents (this creates local files under `~/.aster-agent-audit/` but changes nothing else):

```bash
aster-audit init
```

Want to preview without touching anything? Use `aster-audit init --dry-run`.

Then install the collector hooks so running an agent produces real sessions, tool-calls, tests, and commits in your dashboard:

```bash
aster-audit init --install-hooks
```

- It **backs up your config before changing it** — Claude Code hooks are merged into `settings.json` (existing hooks preserved); Codex is a fenced insert into `config.toml` notify.
- Add `-y` / `--yes` to skip the confirmation prompt.
- To undo cleanly, `aster-audit hooks uninstall` fully restores from the backup.
- Check state anytime with `aster-audit hooks status`.

Each hook reads the agent event from stdin and POSTs it to the local collector, which **redacts secrets before anything is stored**. If the dashboard isn't running, a redacted-minimal event is spooled locally and replayed on your next `aster-audit dashboard`. Hooks never execute commands and never block your agent.

Now run Claude Code or Codex normally, then flip the top-bar toggle to **Live**.

## 4. Check your MCP config

```bash
aster-audit scan
```

Reads your local MCP config files (Claude, Cursor, VS Code, Windsurf, Cline, Gemini) read-only — nothing is executed — and reports findings mirroring AsterGuard's rules: arbitrary shell/eval, pipe-to-shell installs, runtime env injection, hardcoded secrets, unverified remote origins, typosquatted `@modelcontextprotocol` look-alikes, sensitive-file access, privilege escalation, and exfiltration endpoints. Every finding carries a severity, rule id, redacted evidence (never a raw secret), and a recommended action, and rolls up into a posture grade (A–F). Pass a directory to scan a specific project: `aster-audit scan ./my-repo`.

Codex's TOML config is not parsed and is explicitly deferred.

## 5. Confirm health

```bash
aster-audit doctor
```

Checks Node version, that `~/.aster-agent-audit/` is writable and the SQLite DB is readable, whether the collector is running, which agents are detected and hooked, and your current MCP posture grade.

## What you'll see within 5 minutes

- The full dashboard populated with demo data the instant you run `aster-audit dashboard`
- A working demo/live toggle in the top bar
- Your own agents detected by `aster-audit init`, with a safe, backed-up hook install
- Real sessions, tool-calls, tests, and commits after running Claude Code or Codex in Live mode
- An MCP security posture grade from `aster-audit scan`
- A clean health report from `aster-audit doctor`
