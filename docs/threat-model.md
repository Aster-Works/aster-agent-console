# Threat model

What Aster Agent Audit protects, what it assumes, what it detects, and —
stated plainly — what it cannot do. If a claim here and a marketing sentence
ever disagree, this page wins.

## Assets worth protecting

Source code and prompts (never uploaded; the collector is local-only) ·
command history and file paths (the audit record itself) · secrets that pass
through agent tool calls · environment variable names in MCP configs · the
SQLite audit database and its exports · policy files · license data (in
commercial builds).

## Trust boundaries and assumptions

- **Everything runs as your user on your machine.** There is no privilege
  separation between the collector, the agents it observes, and any other
  process in your account. Local-first protects you from *remote* services,
  **not from local compromise** — malware running as your user can read the
  DB, the spool, and the agents' own logs directly.
- The dashboard and collector bind to `127.0.0.1` only; a Host-header guard
  rejects DNS-rebinding attempts; request bodies are size-capped (512 KB);
  incoming payloads are data, never executed.
- Hook scripts read stdin and POST JSON. They never execute event content and
  always exit 0 quickly so they cannot block or break the agent.

## Threats addressed (and how)

| Threat | Mitigation | Honest limit |
|---|---|---|
| Agent emits a secret in a command | Pattern-based redaction BEFORE storage; spool fallback redacts too | **Best-effort.** Novel secret formats pass through. The raw secret still exists in the agent's own logs — rotation is the only real fix |
| Malicious / risky MCP server config | Static scan (JSON + Codex TOML), 9 MCP rules, posture grade, policy gate | Static analysis is **not a sandbox**; a clean scan is not a safety proof; inferred permissions are not authoritative |
| MCP config drifts silently | Inventory fingerprints + new/removed/changed detection | Detects definition changes only; env var *values* are (deliberately) invisible |
| After-the-fact tampering with the audit record | Per-session SHA-256 hash chain; `verify` reports broken links | **Tamper-evidence, not tamper-proofing.** Full-DB rewrite by a local attacker defeats it. Enrichment fields (title/links/metrics/receivedAt) are outside the hash |
| Crafted event payloads | Zod-validated hook schema; malformed input degrades to a best-effort event, never a throw; JSON-only, size-limited endpoint | |
| Malicious report/export content | Evidence is stored redacted; HTML reports escape every interpolated value; exports carry no raw secrets (tested at the boundary) | Redaction remains best-effort — see above |
| Log injection / hostile server names | HTML-escaped in reports; rendered as inert text in the dashboard (never executed, never `dangerouslySetInnerHTML`) | |
| Prompt injection making an agent misuse tools | Dangerous-command and sensitive-file rules flag the *behavior* regardless of what caused it | Detection after the fact; this tool does not block agent actions |
| Unsafe policy weakening the gate | `policy validate` warns on `failOn: "never"`, on disabling critical rules, and on unknown rule ids; broken policy files are skipped, never half-applied | |

## Threats NOT addressed (out of scope, say so)

- **A compromised local account.** Anything running as you can bypass all of
  this — including rewriting the hash chain.
- **Supply-chain attacks on this tool's own dependencies.** Kept few
  (better-sqlite3, hono, commander, smol-toml, React) and pinned via
  lockfile, but not otherwise defended here.
- **Kernel/OS-level attackers, memory inspection, physical access.**
- **Network exfiltration by the agents themselves** outside what their events
  reveal. We observe what agents report and what configs declare — not raw
  network traffic.
- **Symlink/path tricks against the collector's own files** beyond the
  realpath guard on rollout imports; the data directory is assumed to be
  yours and untampered.

## Outbound traffic policy

The default build makes **zero** outbound network requests: no telemetry, no
update checks, no cloud sync. Anything future that transmits data must be
opt-in, off by default, and show exactly what it sends before sending it.

## Exports

Exports (JSON dataset, CSV findings, evidence bundles, SARIF, HTML reports)
contain the stored, redacted records. Once written, a file's protection is
the filesystem's problem — treat evidence bundles like the audit data they
are. Nothing in an export is signed in the Community edition; do not present
a bundle as externally attested.
