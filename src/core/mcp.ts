/**
 * MCP configuration scanner (Phase 6, Roadmap 05 "AsterGuard Integration").
 *
 * Pure and filesystem-free so it is safe in the browser bundle and trivially
 * testable. The filesystem discovery/read layer lives in `src/server/mcp-scan.ts`.
 *
 * Each `AAC-MCP-*` rule mirrors a specific AsterGuard `AG-*` rule (noted per
 * rule). We reimplement a lean, high-signal subset natively rather than take a
 * runtime dependency on `@asterworks/aster-guard`, because the console is
 * local-first and must run offline. If AsterGuard ever ships a stable
 * programmatic API, `scanMcpServers` is the single seam to swap.
 *
 * Server definitions are only ever *inspected as text* — never executed.
 */
import { createHash } from "node:crypto";
import type { AgentName, RiskFinding, RiskSeverity } from "./types";
import type { McpPermission, McpServer } from "./views";
import { fingerprint, hasSecret, redactString } from "./redaction";
import { hostAllowed } from "./policy";
import { canonicalize } from "./integrity/index";

/** A single MCP server definition as it appears in a config file. */
export type RawMcpServer = {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  /** transport hint: "stdio" | "http" | "sse" | "streamable-http" */
  type?: string;
  headers?: Record<string, string>;
};

export type ScannedServerInput = {
  server: RawMcpServer;
  agent: AgentName;
  /** absolute path of the config file this server came from */
  sourceFile: string;
};

export type Grade = "A" | "B" | "C" | "D" | "F";

export type McpScanResult = {
  servers: McpServer[];
  findings: RiskFinding[];
  score: number;
  grade: Grade;
};

// ---- config extraction -----------------------------------------------------

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every((x) => typeof x === "string")
  );
}

/**
 * Pull MCP server definitions out of a parsed config object. Handles both the
 * `mcpServers` key (Claude / Cursor / Windsurf / Cline / Gemini) and the
 * `servers` key (VS Code). Unknown shapes yield an empty list, never a throw.
 */
export function extractServers(json: unknown): RawMcpServer[] {
  if (!json || typeof json !== "object") return [];
  const obj = json as Record<string, unknown>;
  // `mcpServers`: Claude/Cursor/Windsurf/Cline/Gemini · `servers`: VS Code ·
  // `mcp_servers`: Codex config.toml ([mcp_servers.<name>], parsed upstream).
  const block = (obj.mcpServers ?? obj.servers ?? obj.mcp_servers) as unknown;
  if (!block || typeof block !== "object" || Array.isArray(block)) return [];

  const out: RawMcpServer[] = [];
  for (const [name, raw] of Object.entries(block as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    out.push({
      name,
      command: typeof r.command === "string" ? r.command : undefined,
      args: Array.isArray(r.args) ? (r.args.filter((a) => typeof a === "string") as string[]) : undefined,
      env: isStringRecord(r.env) ? (r.env as Record<string, string>) : undefined,
      url: typeof r.url === "string" ? r.url : undefined,
      type:
        typeof r.type === "string"
          ? r.type
          : typeof r.transport === "string"
          ? (r.transport as string)
          : undefined,
      headers: isStringRecord(r.headers) ? (r.headers as Record<string, string>) : undefined,
    });
  }
  return out;
}

// ---- inventory fingerprint ---------------------------------------------------

/**
 * Stable fingerprint of a server DEFINITION for change detection. Covers what
 * the server IS (command/args/url/type/headers keys) and which env vars it
 * receives — by NAME only. Values are deliberately excluded so the inventory
 * never stores a secret; a value-only rotation does not read as a config
 * change, which is the desired behavior.
 */
export function fingerprintServer(s: RawMcpServer): {
  fingerprint: string;
  definition: { command?: string; args?: string[]; url?: string; type?: string; envNames?: string[] };
} {
  const definition = {
    command: s.command,
    args: s.args,
    url: s.url,
    type: s.type,
    envNames: s.env ? Object.keys(s.env).sort() : undefined,
  };
  const fingerprint = createHash("sha256").update(canonicalize(definition)).digest("hex").slice(0, 32);
  return { fingerprint, definition };
}

// ---- rules -----------------------------------------------------------------

type RuleCtx = { server: RawMcpServer; cmd: string; envEntries: [string, string][] };
type McpRule = {
  ruleId: string;
  /** the AsterGuard rule this mirrors */
  mirrors: string;
  category: RiskFinding["category"];
  severity: RiskSeverity;
  title: string;
  describe: string;
  action: string;
  /** returns the offending evidence string, or null if the rule does not fire */
  detect: (ctx: RuleCtx) => string | null;
};

// Env var names that let an attacker inject code into any child process.
const INJECTOR_ENV = new Set([
  "NODE_OPTIONS",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "PYTHONSTARTUP",
  "PERL5OPT",
  "RUBYOPT",
  "JAVA_TOOL_OPTIONS",
  "_JAVA_OPTIONS",
]);

const SECRET_KEY = /(?:token|secret|password|passwd|api[-_]?key|access[-_]?key|private[-_]?key|credential)/i;
// A value that is obviously a stand-in, not a real credential.
const PLACEHOLDER = /your|example|changeme|placeholder|dummy|sample|<.+>|xxx+|\bhere\b|todo|redacted/i;
const SENSITIVE_PATH = /\.ssh\/|\bid_rsa\b|\bid_ed25519\b|\.aws\/|\.git-credentials\b|\.npmrc\b|\.pypirc\b|(?:^|\/|\s|=)\.env(?:\.[\w.-]+)?\b/;
const EXFIL_HOST = /webhook\.site|requestbin(?:\.com|\.net)?|hookbin|pastebin\.com|discord(?:app)?\.com\/api\/webhooks|ngrok\.io|transfer\.sh/i;

const MCP_RULES: McpRule[] = [
  {
    ruleId: "AAC-MCP-001",
    mirrors: "AG-003 / AG-009",
    category: "mcp",
    severity: "high",
    title: "Server can run arbitrary shell code",
    describe:
      "This MCP server's command is a shell or launches an inline evaluator, so it can execute arbitrary code the moment the agent connects.",
    action:
      "Replace the shell/eval command with a specific binary, or remove the server. If a wrapper is required, pin it to a fixed script you control.",
    detect: ({ server, cmd }) => {
      const c = (server.command ?? "").trim();
      if (/^(?:.*\/)?(?:ba|z|k|c)?sh$/.test(c) || /^(?:.*\/)?(?:powershell|pwsh|cmd(?:\.exe)?)$/.test(c)) {
        return cmd;
      }
      if (
        /\b(?:ba|z|k)?sh\s+-c\b/.test(cmd) ||
        /\b(?:node|deno|bun)\b[^|]*\s-e\b/.test(cmd) ||
        /\b(?:python3?|ruby|perl|php)\b[^|]*\s-c\b/.test(cmd) ||
        /\beval\b/.test(cmd) ||
        /\bbase64\b[^|]*\s-d\b/.test(cmd) ||
        /\b(?:atob|fromCharCode)\b/.test(cmd)
      ) {
        return cmd;
      }
      return null;
    },
  },
  {
    ruleId: "AAC-MCP-002",
    mirrors: "AG-004",
    category: "mcp",
    severity: "high",
    title: "Dangerous install pattern",
    describe:
      "The server command fetches and runs a remote script, or installs software globally, before the tool is ever used.",
    action:
      "Download and review any install script, then run it explicitly. Prefer a pinned package version over a curl|sh bootstrap.",
    detect: ({ cmd }) => {
      if (/\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/.test(cmd)) return cmd;
      if (/\bnpm\s+(?:i|install)\b[^|]*\s-g\b/.test(cmd)) return cmd;
      if (/\bpip3?\s+install\b[^|]*--index-url\b/.test(cmd)) return cmd;
      return null;
    },
  },
  {
    ruleId: "AAC-MCP-003",
    mirrors: "AG-013",
    category: "mcp",
    severity: "critical",
    title: "Runtime environment injection",
    describe:
      "An injector environment variable is set on this server. Variables like NODE_OPTIONS or LD_PRELOAD load attacker code into every child process.",
    action:
      "Remove the injector variable from the server's env. If a runtime flag is genuinely required, set it inside a reviewed wrapper script, not in the MCP config.",
    detect: ({ envEntries }) => {
      const hit = envEntries.find(([k]) => INJECTOR_ENV.has(k.toUpperCase()));
      if (!hit) return null;
      return `${hit[0]}=${redactString(hit[1]).text}`;
    },
  },
  {
    ruleId: "AAC-MCP-004",
    mirrors: "AG-005",
    category: "secrets",
    severity: "high",
    title: "Hardcoded secret in server env",
    describe:
      "A credential appears inline in this server's env block. Config files are often committed or synced, so an inline secret is easily leaked.",
    action:
      "Move the value to a local .env and reference it as ${VAR}. Rotate the exposed credential if the file was ever shared or committed.",
    detect: ({ envEntries }) => {
      for (const [k, v] of envEntries) {
        const val = (v ?? "").trim();
        if (!val) continue;
        if (/^\$\{?[\w.-]+\}?$/.test(val)) continue; // ${VAR} reference — the good pattern
        if (PLACEHOLDER.test(val)) continue;
        // hasSecret(val) matches known token shapes (ghp_, sk-, AKIA, jwt…); the
        // key-name branch catches unprefixed 20+ char secrets. Evidence is masked
        // generically so an unprefixed key never leaks even when redactString
        // leaves it untouched.
        const looksSecret = hasSecret(val) || (SECRET_KEY.test(k) && val.length >= 20 && !/\s/.test(val));
        if (looksSecret) {
          const red = redactString(val).text;
          return `${k}=${red === val ? "••••••" : red}`;
        }
      }
      return null;
    },
  },
  {
    ruleId: "AAC-MCP-006",
    mirrors: "AG-014",
    category: "mcp",
    severity: "critical",
    title: "Typosquatted MCP package",
    describe:
      "The command runs a package whose name impersonates the official @modelcontextprotocol scope. A near-miss scope is a common supply-chain attack.",
    action:
      "Verify the package on npm. Use the exact official name (@modelcontextprotocol/...) or a vendor you trust. Do not install look-alike scopes.",
    detect: ({ cmd }) => {
      // Any scoped token claiming to be modelcontext* but not the canonical
      // @modelcontextprotocol scope is a supply-chain look-alike.
      const tokens = cmd.match(/@[\w.-]+(?:\/[\w.-]+)?/g) ?? [];
      for (const t of tokens) {
        const scope = t.split("/")[0].toLowerCase();
        if (/model.*context/.test(scope) && scope !== "@modelcontextprotocol") return t;
      }
      return null;
    },
  },
  {
    ruleId: "AAC-MCP-007",
    mirrors: "AG-002",
    category: "files",
    severity: "high",
    title: "Server reaches for sensitive files",
    describe:
      "The server command references credential or key files (SSH keys, AWS creds, .env). A tool that reads these can exfiltrate them.",
    action:
      "Confirm the server needs these paths. Scope filesystem access to the project directory and keep credential files out of any tool's reach.",
    detect: ({ cmd }) => (SENSITIVE_PATH.test(cmd) ? cmd : null),
  },
  {
    ruleId: "AAC-MCP-008",
    mirrors: "AG-015",
    category: "mcp",
    severity: "critical",
    title: "Privilege escalation in server command",
    describe:
      "The server command elevates privileges (sudo, container --privileged, setcap). This grants the tool far more power than a coding assistant needs.",
    action:
      "Do not run with elevated privileges. Remove the escalation and run the server as your normal user.",
    detect: ({ cmd }) =>
      /\bsudo\s+-S\b|\bsu\s+root\b|\bnsenter\b|\bunshare\b|docker\s+run[^|]*--privileged|--cap-add\b|chmod\s+\+s\b|\bsetcap\b|\bptrace\b|\binsmod\b|\bmodprobe\b/.test(
        cmd
      )
        ? cmd
        : null,
  },
  {
    ruleId: "AAC-MCP-009",
    mirrors: "AG-011",
    category: "network",
    severity: "critical",
    title: "Credential exfiltration endpoint",
    describe:
      "The server command references a data-exfiltration endpoint (webhook.site, pastebin, a Discord webhook). These are used to smuggle secrets off the machine.",
    action:
      "Remove the server. If this is a legitimate integration, route it through a reviewed, first-party endpoint instead of an anonymous relay.",
    detect: ({ cmd }) => {
      const m = cmd.match(EXFIL_HOST);
      return m ? m[0] : null;
    },
  },
];

// Remote-origin rule (AAC-MCP-005, mirrors AG-007) is handled inline in
// scanMcpServers because it is policy-aware (host allowlist).
const REMOTE_RULE = {
  ruleId: "AAC-MCP-005",
  mirrors: "AG-007",
  category: "network" as const,
  severity: "medium" as RiskSeverity,
  title: "Remote MCP server, unverified origin",
  action:
    "Confirm you trust this host and prefer HTTPS. Once vetted, add it to allowedMcpHosts in policy.json to silence this finding.",
};

// ---- scanning --------------------------------------------------------------

function makeFinding(
  ruleId: string,
  mirrors: string,
  category: RiskFinding["category"],
  severity: RiskSeverity,
  title: string,
  describe: string,
  action: string,
  server: string,
  sourceFile: string,
  evidence: string
): RiskFinding {
  const file = sourceFile.split("/").pop() || sourceFile;
  return {
    id: `risk_${fingerprint(`${ruleId}:${sourceFile}:${server}:${evidence}`)}`,
    ruleId,
    category,
    severity,
    title,
    description: `${describe} (server "${server}" in ${file}; mirrors AsterGuard ${mirrors})`,
    recommendedAction: action,
    redactedEvidence: redactString(evidence).text,
  };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])$/i;

function transportOf(server: RawMcpServer): McpServer["transport"] {
  const t = server.type?.toLowerCase();
  if (t === "sse") return "sse";
  if (server.url || t === "http" || t === "streamable-http") return "http";
  return "stdio";
}

function inferPermissions(server: RawMcpServer, cmd: string, findings: RiskFinding[]): McpPermission[] {
  const set = new Set<McpPermission>();
  if (server.url || /\b(?:curl|wget|fetch|https?:\/\/)\b/.test(cmd)) set.add("network");
  if (findings.some((f) => f.ruleId === "AAC-MCP-001" || f.ruleId === "AAC-MCP-008")) set.add("exec");
  const envKeys = server.env ? Object.keys(server.env) : [];
  if (envKeys.some((k) => SECRET_KEY.test(k)) || findings.some((f) => f.category === "secrets")) {
    set.add("secrets");
  }
  if (/filesystem|(?:^|\/|\s)fs(?:\s|$)|readfile|writefile|\bfile\b/i.test(`${server.name} ${cmd}`)) {
    set.add("read");
    if (/\bwrite\b|\bedit\b|--allow-write/i.test(cmd)) set.add("write");
  }
  if (set.size === 0) set.add(server.command ? "read" : "network");
  return [...set];
}

function maxSeverity(findings: RiskFinding[]): RiskSeverity {
  const order: RiskSeverity[] = ["info", "low", "medium", "high", "critical"];
  let best = 0;
  for (const f of findings) best = Math.max(best, order.indexOf(f.severity));
  return order[best];
}

/**
 * Scan a set of MCP server definitions. Returns view-model servers (for the MCP
 * map) and flat findings (for the Risk Radar), plus an AsterGuard-style A–F
 * posture grade. `allowedHosts` comes from policy and suppresses AAC-MCP-005 for
 * hosts the user has vetted.
 */
export function scanMcpServers(inputs: ScannedServerInput[], allowedHosts: string[] = []): McpScanResult {
  const servers: McpServer[] = [];
  const allFindings: RiskFinding[] = [];

  for (const { server, agent, sourceFile } of inputs) {
    const cmd = [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
    const envEntries = server.env ? Object.entries(server.env) : [];
    const ctx: RuleCtx = { server, cmd, envEntries };
    const local: RiskFinding[] = [];

    for (const rule of MCP_RULES) {
      const evidence = rule.detect(ctx);
      if (evidence != null) {
        local.push(
          makeFinding(
            rule.ruleId,
            rule.mirrors,
            rule.category,
            rule.severity,
            rule.title,
            rule.describe,
            rule.action,
            server.name,
            sourceFile,
            evidence
          )
        );
      }
    }

    // AAC-MCP-005 — remote origin (policy-aware).
    if (server.url) {
      const host = hostOf(server.url);
      if (host && !LOCAL_HOST.test(host) && !hostAllowed(host, allowedHosts)) {
        const insecure = server.url.startsWith("http://");
        local.push(
          makeFinding(
            REMOTE_RULE.ruleId,
            REMOTE_RULE.mirrors,
            REMOTE_RULE.category,
            insecure ? "high" : REMOTE_RULE.severity,
            REMOTE_RULE.title,
            `This server connects to the remote host "${host}"${insecure ? " over plaintext HTTP" : ""}. A remote MCP server can see everything the agent sends it.`,
            REMOTE_RULE.action,
            server.name,
            sourceFile,
            server.url
          )
        );
      }
    }

    allFindings.push(...local);
    servers.push({
      id: `mcp_${fingerprint(`${sourceFile}:${server.name}`)}`,
      name: server.name,
      agent,
      transport: transportOf(server),
      permissions: inferPermissions(server, cmd, local),
      risk: local.length ? maxSeverity(local) : "info",
      note: local.length ? local.sort((a, b) => sevRank(b.severity) - sevRank(a.severity))[0].title : "No issues detected.",
    });
  }

  const { score, grade } = scoreFindings(allFindings);
  return { servers, findings: allFindings, score, grade };
}

function sevRank(s: RiskSeverity): number {
  return ["info", "low", "medium", "high", "critical"].indexOf(s);
}

// AsterGuard scoring model (src/core/scoring.ts): start 100, subtract per finding.
const SEVERITY_WEIGHT: Record<RiskSeverity, number> = {
  critical: 35,
  high: 25,
  medium: 12,
  low: 5,
  info: 0,
};

export function scoreFindings(findings: { severity: RiskSeverity }[]): { score: number; grade: Grade } {
  let score = 100;
  for (const f of findings) score -= SEVERITY_WEIGHT[f.severity];
  score = Math.max(0, Math.min(100, score));
  const grade: Grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { score, grade };
}

/** Read-only catalog of the active MCP-risk rules (for the Settings UI). */
export function mcpRuleCatalog(): { ruleId: string; category: RiskFinding["category"]; severity: RiskSeverity; title: string }[] {
  // REMOTE_RULE (AAC-MCP-005) is detected inline in scanMcpServers because it
  // is policy-aware, but it IS one of the shipped rules — the catalog was
  // silently one short before it was appended here.
  return [
    ...MCP_RULES.map((r) => ({ ruleId: r.ruleId, category: r.category, severity: r.severity, title: r.title })),
    { ruleId: REMOTE_RULE.ruleId, category: REMOTE_RULE.category, severity: REMOTE_RULE.severity, title: REMOTE_RULE.title },
  ].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}
