/**
 * Generates a self-contained hook script (no imports from this package) that an
 * agent runs on each event. The script:
 *   - reads the hook JSON from stdin (or argv for `notify`-style callers),
 *   - POSTs { agent, payload } to the local collector with a short timeout,
 *   - if the collector is down, appends a REDACTED, minimal event to the spool,
 *   - never executes anything and never blocks the agent (always exits 0 fast).
 */
export function hookScript(agent: string, endpoint: string): string {
  return `#!/usr/bin/env node
// Aster Agent Audit hook for ${agent}. Generated — safe to delete.
// It forwards events to the local collector and never executes commands.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENT = ${JSON.stringify(agent)};
const ENDPOINT = ${JSON.stringify(endpoint)};
// Spool next to this script (<data dir>/hooks/ → <data dir>/spool/), so the
// script keeps working wherever the data directory lives or is renamed to.
const SPOOL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "spool");
const TIMEOUT_MS = 1200;

function stripSecrets(text) {
  return String(text)
    .replace(/sk-ant-[A-Za-z0-9_-]{20,}/g, "sk-ant-[redacted]")
    .replace(/sk-[A-Za-z0-9][A-Za-z0-9_-]{18,}/g, "sk-[redacted]")
    .replace(/(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g, "gh-token-[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}/g, "jwt-[redacted]")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\\s\\S]*?-----END [^-]*PRIVATE KEY-----/g, "private-key-[redacted]")
    .replace(/([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD)[A-Za-z0-9_]*\\s*=\\s*)("?)([^"\\s]{6,})/gi, "$1$2[redacted]");
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    setTimeout(() => resolve(data), 800);
  });
}

function spool(payload) {
  try {
    mkdirSync(SPOOL_DIR, { recursive: true });
    let redacted = {};
    try { redacted = JSON.parse(stripSecrets(JSON.stringify(payload ?? {}))); } catch {}
    const rec = { agent: AGENT, payload: redacted, spooledAt: new Date().toISOString() };
    appendFileSync(join(SPOOL_DIR, "spool.jsonl"), JSON.stringify(rec) + "\\n");
  } catch {}
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : process.argv[2] ? JSON.parse(process.argv[2]) : {};
  } catch {
    payload = {};
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: AGENT, payload }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) spool(payload);
  } catch {
    spool(payload);
  }
  process.exit(0);
}

main();
`;
}
