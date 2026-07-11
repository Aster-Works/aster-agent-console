# MCP Security Scan

`aster-audit scan` inspects the MCP (Model Context Protocol) server configs on your machine for risky server definitions, and the dashboard's **Risk Radar** surfaces the same findings live. It is a static, heuristic check — read-only and offline. It is not exhaustive; treat it as defense-in-depth, not a guarantee.

## What it does

The scan **discovers JSON MCP config files, reads them, and inspects each server definition as text**. It never executes a command, never launches a server, and never makes a network call. Config files are opened read-only.

```bash
# Scan the current directory + your home config, exit non-zero if it finds
# something at/above your failOn threshold (CI / pre-flight gate)
aster-audit scan

# Scan a specific project directory instead of the cwd
aster-audit scan ./path/to/repo
```

The same results power the **Risk Radar** screen in `aster-audit dashboard`, including the A–F posture grade.

> **Beta, and honest about it.** These rules catch high-signal patterns; they will miss novel or obfuscated tricks. A clean scan means "nothing matched," not "provably safe."

## Discovery paths

`scan [dir]` looks for these files. Project-scope files are resolved under the target directory (cwd or `[dir]`); user-scope files under your home directory. A file is only read if it exists and parses as JSON; for each file the scanner reads whichever of the `mcpServers` or `servers` key is present.

**Project scope (under the scanned directory):**

| File | Attributed agent |
|---|---|
| `.mcp.json` | Claude Code |
| `.cursor/mcp.json` | Cursor |
| `.vscode/mcp.json` | (unknown) |
| `.claude/settings.json` | Claude Code |
| `.claude/settings.local.json` | Claude Code |

**User scope (under `~`):**

| File | Attributed agent |
|---|---|
| `~/.claude.json` | Claude Code |
| `~/.claude/settings.json` | Claude Code |
| `~/.cursor/mcp.json` | Cursor |
| `~/.codeium/windsurf/mcp_config.json` | Windsurf (unknown) |
| `~/.gemini/settings.json` | Gemini CLI |
| `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | Cline (unknown) |

**Codex IS scanned** (since 0.2.0). `~/.codex/config.toml`'s `[mcp_servers.<name>]` tables are parsed with a maintained TOML parser (smol-toml) and normalized into the same canonical server model as JSON configs, so every rule applies uniformly.

## Rules (AAC-MCP-001..009)

Each rule mirrors an AsterGuard `AG-*` rule. Findings carry a `redactedEvidence` field — it is masked and **never contains a raw secret**. Commands are only ever inspected as text.

| Rule | Detects | Severity | Mirrors |
|---|---|---|---|
| **AAC-MCP-001** | Command is a shell (`sh`/`bash`/`zsh`/`pwsh`/`cmd`…) or launches an inline evaluator (`sh -c`, `node -e`, `python -c`, `eval`, `base64 -d`…) — arbitrary code on connect | high | AG-003 / AG-009 |
| **AAC-MCP-002** | Dangerous install: `curl\|sh` / `wget\|sh` pipe-to-shell, global `npm install -g`, `pip install --index-url` | high | AG-004 |
| **AAC-MCP-003** | Runtime env injection: `NODE_OPTIONS`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_INSERT_LIBRARIES`, `DYLD_LIBRARY_PATH`, `PYTHONSTARTUP`, `PERL5OPT`, `RUBYOPT`, `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS` set in the server env | critical | AG-013 |
| **AAC-MCP-004** | Hardcoded secret inline in the server `env`. `${VAR}` references and obvious placeholders (`your…`, `changeme`, `<...>`, `xxx…`) are **not** flagged | high | AG-005 |
| **AAC-MCP-005** | Remote server at an unverified origin. `localhost`, allowlisted hosts → **no finding**; plaintext `http://` escalates **medium → high** | medium | AG-007 |
| **AAC-MCP-006** | Typosquatted `@modelcontextprotocol` look-alike scope (any scope matching `model…context` that isn't the canonical `@modelcontextprotocol`) | critical | AG-014 |
| **AAC-MCP-007** | Command references sensitive files: `.ssh/`, `id_rsa`, `id_ed25519`, `.aws/`, `.git-credentials`, `.npmrc`, `.env`… | high | AG-002 |
| **AAC-MCP-008** | Privilege escalation: `sudo -S`, `su root`, `docker run --privileged`, `--cap-add`, `setcap`, `nsenter`, `insmod`… | critical | AG-015 |
| **AAC-MCP-009** | Credential exfiltration endpoint: `webhook.site`, `requestbin`, `pastebin.com`, Discord webhook, `ngrok.io`, `transfer.sh`… | critical | AG-011 |

## Posture grade

The scan applies AsterGuard's scoring model. Start at **100**, subtract per finding, clamp to `[0, 100]`:

| Severity | Points off |
|---|---|
| critical | 35 |
| high | 25 |
| medium | 12 |
| low | 5 |
| info | 0 |

Grade from the final score: **A** ≥ 90, **B** ≥ 75, **C** ≥ 60, **D** ≥ 40, **F** < 40.

Policy-ignored rules are removed before scoring, so silencing a rule you've vetted also improves the displayed grade.

## Policy: `policy.json`

Drop an optional `policy.json` in `~/.aster-agent-audit/` to tune what the scan surfaces and when it fails. Policy is advisory over **display and exit code only** — it never changes what the database records. The DB keeps the honest, unfiltered log.

```json
{
  "allowedMcpHosts": ["*.example.com", "mcp.internal.corp"],
  "ignoreRules": ["AAC-MCP-005"],
  "failOn": "high"
}
```

| Field | What it does |
|---|---|
| `allowedMcpHosts` | Hosts you've vetted for **AAC-MCP-005**. `example.com` matches exactly; `*.example.com` matches any subdomain **and** the apex. Matching hosts produce no remote-origin finding. |
| `ignoreRules` | Rule ids suppressed everywhere — dropped from Risk Radar, the scan output, the exit-code check, and the grade. |
| `failOn` | Severity at which `aster-audit scan` exits non-zero. Default `"high"` (high + critical fail; medium and below do not). Set `"never"` to disable the gate. Also accepts `"critical"`, `"medium"`, `"low"`, `"info"`. |

A missing or malformed `policy.json` is treated as empty policy — the scan still runs with defaults.

### Exit codes (CI)

`aster-audit scan` sets a non-zero exit code by itself when any surviving finding is at or above `failOn` (default `high`). Everything below the threshold is reported but exits `0` — so a bare `aster-audit scan` already fails the build on a high/critical finding, no `|| exit 1` needed.

```bash
# Fails the build on any high or critical MCP finding
aster-audit scan
```

## Why we reimplement AsterGuard natively

These rules mirror [AsterGuard](https://github.com/Aster-Works/aster-guard) `AG-*` rules, but the console reimplements a lean, high-signal subset **natively** rather than depending on AsterGuard at runtime. The console is local-first and must work **offline with no runtime dependency**. If AsterGuard ships a stable programmatic API, `scanMcpServers` is the single seam to swap in.
