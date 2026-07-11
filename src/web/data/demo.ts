/**
 * Deterministic demo dataset for Aster Agent Audit (Phase 1).
 *
 * Authored, not random, so the cockpit looks identical on every load and the
 * UI can be built before the collector exists. Contains both agents, the
 * required realistic file paths, at least one redacted secret finding
 * (sk-••••••) and at least one dangerous-command warning — none of which is
 * ever executed.
 */
import type {
  AgentSession,
  FileChange,
  NormalizedAgentEvent,
} from "@core/types";
import type {
  GitCommitNode,
  HeatCell,
  HotFile,
  McpServer,
  PolicyEvent,
  RepoActivity,
  RiskRow,
  TreemapNode,
} from "@core/views";
import { seeded } from "@core/aggregate";

/**
 * Anchored to *today*, not to a hardcoded date. A fixed date is a time bomb:
 * once it drifts past the default 7-day range, every screen of a fresh
 * `npx @asterworks/agent-audit dashboard` renders empty. Times of day stay
 * fixed, so the demo is still deterministic within any given day.
 */
export const DEMO_TODAY = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local
const TZ = "+09:00";

/** Fixed ISO timestamp helper (JST) — keeps demo deterministic within a day. */
function at(day: string, time: string): string {
  return `${day}T${time}${TZ}`;
}

export const DEMO_REPOS = [
  "aster-agent-audit",
  "aster-support-navi",
  "keryx",
] as const;

const REPO = "/Users/dev/code/aster-agent-audit";

// ----------------------------------------------------------------------------
// Sessions
// ----------------------------------------------------------------------------

export const demoSessions: AgentSession[] = [
  {
    id: "sess_cc_01",
    agent: "claude-code",
    startedAt: at(DEMO_TODAY, "10:08:02"),
    endedAt: at(DEMO_TODAY, "10:51:40"),
    repoPath: REPO,
    cwd: REPO,
    model: "claude-opus-4-8",
    status: "completed",
    summary: "Implement session orchestration",
    totalTokens: 184_200,
    estimatedCostUsd: 1.74,
    filesChanged: 9,
    commits: 2,
    testsPassed: 41,
    testsFailed: 0,
    riskCount: 2,
    maxRiskSeverity: "critical",
  },
  {
    id: "sess_cx_01",
    agent: "codex",
    startedAt: at(DEMO_TODAY, "09:31:11"),
    endedAt: at(DEMO_TODAY, "09:58:25"),
    repoPath: REPO,
    cwd: REPO,
    model: "gpt-5-codex",
    status: "completed",
    summary: "Parser hardening for hook payloads",
    totalTokens: 96_400,
    estimatedCostUsd: 0.62,
    filesChanged: 4,
    commits: 1,
    testsPassed: 18,
    testsFailed: 1,
    riskCount: 1,
    maxRiskSeverity: "high",
  },
  {
    id: "sess_cc_02",
    agent: "claude-code",
    startedAt: at(DEMO_TODAY, "08:46:30"),
    endedAt: at(DEMO_TODAY, "09:12:07"),
    repoPath: REPO,
    model: "claude-opus-4-8",
    status: "completed",
    summary: "Refactor redaction pipeline",
    totalTokens: 132_800,
    estimatedCostUsd: 1.18,
    filesChanged: 6,
    commits: 1,
    testsPassed: 33,
    testsFailed: 0,
    riskCount: 1,
    maxRiskSeverity: "medium",
  },
  {
    id: "sess_cx_02",
    agent: "codex",
    startedAt: at(DEMO_TODAY, "08:20:15"),
    endedAt: at(DEMO_TODAY, "08:39:51"),
    repoPath: REPO,
    model: "gpt-5-codex",
    status: "failed",
    summary: "Treemap layout math",
    totalTokens: 54_100,
    estimatedCostUsd: 0.31,
    filesChanged: 2,
    commits: 0,
    testsPassed: 7,
    testsFailed: 4,
    riskCount: 0,
    maxRiskSeverity: "low",
  },
  {
    id: "sess_cc_03",
    agent: "claude-code",
    startedAt: at(DEMO_TODAY, "07:55:44"),
    endedAt: at(DEMO_TODAY, "08:14:02"),
    repoPath: REPO,
    model: "claude-sonnet-4-6",
    status: "completed",
    summary: "Fix flaky agent tests",
    totalTokens: 71_900,
    estimatedCostUsd: 0.44,
    filesChanged: 3,
    commits: 1,
    testsPassed: 41,
    testsFailed: 0,
    riskCount: 1,
    maxRiskSeverity: "low",
  },
  {
    id: "sess_cx_03",
    agent: "codex",
    startedAt: at(DEMO_TODAY, "11:02:09"),
    repoPath: REPO,
    model: "gpt-5-codex",
    status: "active",
    summary: "CLI doctor checks",
    totalTokens: 38_600,
    estimatedCostUsd: 0.21,
    filesChanged: 2,
    commits: 0,
    testsPassed: 9,
    testsFailed: 0,
    riskCount: 1,
    maxRiskSeverity: "medium",
  },
  {
    id: "sess_cc_04",
    agent: "claude-code",
    startedAt: at(DEMO_TODAY, "06:41:18"),
    endedAt: at(DEMO_TODAY, "07:09:55"),
    repoPath: REPO,
    model: "claude-opus-4-8",
    status: "completed",
    summary: "Wire SSE live updates",
    totalTokens: 88_300,
    estimatedCostUsd: 0.71,
    filesChanged: 4,
    commits: 1,
    testsPassed: 22,
    testsFailed: 0,
    riskCount: 0,
    maxRiskSeverity: "info",
  },
  {
    id: "sess_cx_04",
    agent: "codex",
    startedAt: at(DEMO_TODAY, "06:12:40"),
    endedAt: at(DEMO_TODAY, "06:35:20"),
    repoPath: REPO,
    model: "gpt-5-codex",
    status: "completed",
    summary: "Migrate to better-sqlite3",
    totalTokens: 64_700,
    estimatedCostUsd: 0.39,
    filesChanged: 5,
    commits: 1,
    testsPassed: 15,
    testsFailed: 0,
    riskCount: 1,
    maxRiskSeverity: "medium",
  },
];

// ----------------------------------------------------------------------------
// Risk findings (flat — Risk Radar source of truth)
// ----------------------------------------------------------------------------

export const demoRisk: RiskRow[] = [
  {
    id: "risk_01",
    ruleId: "AAC-SECRET-001",
    severity: "critical",
    category: "secrets",
    title: "API key exposed in tool input",
    description:
      "An Anthropic-style API key was detected in a Bash command argument before redaction. The value was redacted prior to storage; no raw secret was persisted.",
    redactedEvidence: 'export ANTHROPIC_API_KEY=sk-ant-••••••••••••••••3f9a',
    recommendedAction:
      "Rotate the exposed key immediately and move it to a local .env that is never passed inline to shell tools.",
    agent: "claude-code",
    sessionId: "sess_cc_01",
    eventId: "evt_cc_secret",
    repoPath: REPO,
    timestamp: at(DEMO_TODAY, "10:23:51"),
    status: "open",
  },
  {
    id: "risk_02",
    ruleId: "AAC-GIT-014",
    severity: "high",
    category: "git",
    title: "Force push to a protected branch",
    description:
      "The agent proposed a force push to origin/main. Force pushes rewrite shared history and can destroy collaborators' work.",
    redactedEvidence: "git push --force origin main",
    recommendedAction:
      "Use --force-with-lease against a feature branch, never main. Confirm with a human before rewriting shared history.",
    agent: "codex",
    sessionId: "sess_cx_01",
    eventId: "evt_cx_forcepush",
    repoPath: REPO,
    timestamp: at(DEMO_TODAY, "09:52:14"),
    status: "open",
  },
  {
    id: "risk_03",
    ruleId: "AAC-SHELL-002",
    severity: "high",
    category: "shell",
    title: "Recursive delete with wildcard",
    description:
      "A recursive force-delete touching a path resolved from a variable was detected. If the variable is empty this can delete an unexpected tree.",
    redactedEvidence: "rm -rf \"$BUILD_DIR\"/* dist .turbo",
    recommendedAction:
      "Guard the variable (set -u) and scope deletes to an explicit, repo-relative path. Avoid rm -rf on interpolated paths.",
    agent: "codex",
    sessionId: "sess_cx_02",
    eventId: "evt_cx_rmrf",
    repoPath: REPO,
    timestamp: at(DEMO_TODAY, "08:28:03"),
    status: "acknowledged",
  },
  {
    id: "risk_04",
    ruleId: "AAC-MCP-007",
    severity: "medium",
    category: "mcp",
    title: "MCP server requests broad exec capability",
    description:
      "The shell-exec MCP server is configured with unrestricted command execution and no allowlist, exposing the host to arbitrary commands.",
    redactedEvidence: 'server "shell-exec": { exec: "*", cwd: "$HOME" }',
    recommendedAction:
      "Restrict the server to a command allowlist and a repo-scoped working directory. Disable when not actively needed.",
    agent: "codex",
    sessionId: "sess_cx_03",
    eventId: "evt_cx_mcp",
    repoPath: REPO,
    timestamp: at(DEMO_TODAY, "11:14:30"),
    status: "open",
  },
  {
    id: "risk_05",
    ruleId: "AAC-NET-003",
    severity: "medium",
    category: "network",
    title: "Outbound network during code edit",
    description:
      "A curl request to an external host occurred while the session was editing source files. Network access during code generation can exfiltrate context.",
    redactedEvidence: "curl -s https://api.example.com/ingest -d @context.json",
    recommendedAction:
      "Review the destination host and payload. Disable network tools during sensitive edits unless explicitly required.",
    agent: "claude-code",
    sessionId: "sess_cc_02",
    eventId: "evt_cc_net",
    repoPath: REPO,
    timestamp: at(DEMO_TODAY, "09:03:47"),
    status: "acknowledged",
  },
  {
    id: "risk_06",
    ruleId: "AAC-FILE-005",
    severity: "medium",
    category: "files",
    title: "Write outside repository root",
    description:
      "A file write targeted a path above the repository root (~/.config). Writes outside the repo are not captured by version control or review.",
    redactedEvidence: "write → ~/.config/agent/cache.json",
    recommendedAction:
      "Keep generated artifacts inside the repo or an ignored temp dir. Confirm any write to user config directories.",
    agent: "codex",
    sessionId: "sess_cx_04",
    eventId: "evt_cx_file",
    repoPath: REPO,
    timestamp: at(DEMO_TODAY, "06:27:11"),
    status: "resolved",
  },
  {
    id: "risk_07",
    ruleId: "AAC-GIT-002",
    severity: "low",
    category: "git",
    title: "Hard reset discards working changes",
    description:
      "git reset --hard was run, discarding uncommitted changes in the working tree.",
    redactedEvidence: "git reset --hard HEAD~1",
    recommendedAction:
      "Prefer git stash to preserve work. Confirm there are no unsaved edits before a hard reset.",
    agent: "claude-code",
    sessionId: "sess_cc_03",
    eventId: "evt_cc_reset",
    repoPath: REPO,
    timestamp: at(DEMO_TODAY, "08:02:36"),
    status: "resolved",
  },
  {
    id: "risk_08",
    ruleId: "AAC-SHELL-009",
    severity: "low",
    category: "shell",
    title: "Permissive file mode (chmod 777)",
    description:
      "A world-writable permission mode was applied to a script, allowing any local user to modify it.",
    redactedEvidence: "chmod 777 ./scripts/postinstall.sh",
    recommendedAction:
      "Use the least-privilege mode (e.g. 755 for executables). Avoid 777 on anything in a shared environment.",
    agent: "claude-code",
    sessionId: "sess_cc_01",
    eventId: "evt_cc_chmod",
    repoPath: REPO,
    timestamp: at(DEMO_TODAY, "10:39:22"),
    status: "open",
  },
  {
    id: "risk_09",
    ruleId: "AAC-SECRET-004",
    severity: "info",
    category: "secrets",
    title: ".env file read by tool",
    description:
      "A tool read a .env file. This is common and often benign, but its values are candidates for redaction monitoring.",
    redactedEvidence: "read → .env (12 keys, values redacted)",
    recommendedAction:
      "No action required. Confirm the .env is git-ignored and values stay local.",
    agent: "claude-code",
    sessionId: "sess_cc_04",
    timestamp: at(DEMO_TODAY, "06:48:09"),
    status: "resolved",
  },
];

// ----------------------------------------------------------------------------
// File changes
// ----------------------------------------------------------------------------

export const demoFileChanges: FileChange[] = [
  fc("fc_01", "sess_cc_01", "src/server/events.ts", "added", 132, 0, "claude-code", "10:18:40"),
  fc("fc_02", "sess_cc_01", "src/app/dashboard.tsx", "modified", 88, 24, "claude-code", "10:31:12"),
  fc("fc_03", "sess_cc_01", "src/web/routes/RiskRadar.tsx", "modified", 64, 12, "claude-code", "10:34:55"),
  fc("fc_04", "sess_cc_01", "tests/agent.test.ts", "modified", 47, 6, "claude-code", "10:44:18"),
  fc("fc_05", "sess_cx_01", "src/lib/parser.ts", "modified", 71, 33, "codex", "09:40:02"),
  fc("fc_06", "sess_cx_01", "src/core/normalize.ts", "modified", 29, 9, "codex", "09:44:51"),
  fc("fc_07", "sess_cc_02", "src/core/redaction.ts", "modified", 156, 41, "claude-code", "08:52:30"),
  fc("fc_08", "sess_cc_02", "tests/redaction.test.ts", "added", 92, 0, "claude-code", "09:01:11"),
  fc("fc_09", "sess_cx_02", "src/web/components/Treemap.tsx", "modified", 38, 52, "codex", "08:31:40"),
  fc("fc_10", "sess_cc_03", "tests/agent.test.ts", "modified", 18, 22, "claude-code", "08:05:00"),
  fc("fc_11", "sess_cc_04", "src/server/sse.ts", "added", 74, 0, "claude-code", "06:55:20"),
  fc("fc_12", "sess_cx_04", "src/db/index.ts", "modified", 110, 67, "codex", "06:20:33"),
  fc("fc_13", "sess_cx_04", "src/db/schema.sql", "added", 58, 0, "codex", "06:24:10"),
  fc("fc_14", "sess_cc_01", "src/web/app/dashboard.tsx", "modified", 26, 4, "claude-code", "10:47:02"),
];

function fc(
  id: string,
  sessionId: string,
  filePath: string,
  changeType: FileChange["changeType"],
  linesAdded: number,
  linesDeleted: number,
  agent: FileChange["agent"],
  time: string
): FileChange {
  return {
    id,
    sessionId,
    repoPath: REPO,
    filePath,
    changeType,
    linesAdded,
    linesDeleted,
    agent,
    timestamp: at(DEMO_TODAY, time),
  };
}

// ----------------------------------------------------------------------------
// Detailed session timelines (Session Replay)
// ----------------------------------------------------------------------------

function findRisk(id: string): RiskRow | undefined {
  return demoRisk.find((r) => r.eventId === id);
}

function riskToFinding(r: RiskRow) {
  return [
    {
      id: r.id,
      severity: r.severity,
      category: r.category,
      title: r.title,
      description: r.description,
      redactedEvidence: r.redactedEvidence,
      recommendedAction: r.recommendedAction,
      ruleId: r.ruleId,
    },
  ];
}

const sessCc01Events: NormalizedAgentEvent[] = [
  ev("evt_cc_01", "claude-code", "session_start", "sess_cc_01", "10:08:02", {
    title: "Session started",
    summary: "claude-opus-4-8 · aster-agent-audit",
  }),
  ev("evt_cc_02", "claude-code", "user_prompt", "sess_cc_01", "10:08:40", {
    title: "Implement session orchestration",
    summary:
      "Group incoming hook events into sessions and surface them in the dashboard.",
    metrics: { inputTokens: 1240 },
  }),
  ev("evt_cc_03", "claude-code", "pre_tool_use", "sess_cc_01", "10:10:14", {
    toolName: "Read",
    title: "Read src/server/events.ts",
    summary: "Inspect existing event ingestion path.",
  }),
  ev("evt_cc_04", "claude-code", "post_tool_use", "sess_cc_01", "10:10:51", {
    toolName: "Read",
    title: "Read complete",
    summary: "212 lines · no writes",
    metrics: { durationMs: 410 },
    // A real post_tool_use carries the tool input; without it the row would read
    // "Read complete" instead of naming the file that was read.
    links: { files: ["src/server/events.ts"] },
  }),
  ev("evt_cc_05", "claude-code", "pre_tool_use", "sess_cc_01", "10:17:02", {
    toolName: "Write",
    title: "Create src/server/events.ts",
    summary: "Add session orchestration + normalization entry point.",
  }),
  ev("evt_cc_06", "claude-code", "file_change", "sess_cc_01", "10:18:40", {
    title: "src/server/events.ts",
    summary: "+132 / −0 · added",
    metrics: { filesChanged: 1, linesAdded: 132, linesDeleted: 0 },
    links: { files: ["src/server/events.ts"] },
  }),
  ev("evt_cc_secret", "claude-code", "risk_finding", "sess_cc_01", "10:23:51", {
    toolName: "Bash",
    title: "API key exposed in tool input",
    summary: "Critical · secrets · redacted before storage",
    risk: riskToFinding(findRisk("evt_cc_secret")!),
  }),
  ev("evt_cc_07", "claude-code", "pre_tool_use", "sess_cc_01", "10:30:09", {
    toolName: "Edit",
    title: "Edit src/app/dashboard.tsx",
    summary: "Render grouped sessions in the Overview list.",
  }),
  ev("evt_cc_08", "claude-code", "file_change", "sess_cc_01", "10:31:12", {
    title: "src/app/dashboard.tsx",
    summary: "+88 / −24 · modified",
    metrics: { filesChanged: 1, linesAdded: 88, linesDeleted: 24 },
    links: { files: ["src/app/dashboard.tsx"] },
  }),
  ev("evt_cc_chmod", "claude-code", "risk_finding", "sess_cc_01", "10:39:22", {
    toolName: "Bash",
    title: "Permissive file mode (chmod 777)",
    summary: "Low · shell",
    risk: riskToFinding(findRisk("evt_cc_chmod")!),
  }),
  ev("evt_cc_09", "claude-code", "pre_tool_use", "sess_cc_01", "10:42:30", {
    toolName: "Bash",
    title: "Run pnpm test",
    summary: "Validate orchestration changes.",
  }),
  ev("evt_cc_10", "claude-code", "test_result", "sess_cc_01", "10:44:18", {
    toolName: "Bash",
    title: "pnpm test — 41 passed",
    summary: "0 failed · 3.2s",
    metrics: { exitCode: 0, durationMs: 3210 },
  }),
  ev("evt_cc_11", "claude-code", "git_event", "sess_cc_01", "10:49:05", {
    toolName: "Bash",
    title: "Commit: feat(server): session orchestration",
    summary: "2 files · main",
    links: { commitSha: "a1c9f04", branch: "feat/session-orchestration" },
    metrics: { filesChanged: 2 },
  }),
  ev("evt_cc_12", "claude-code", "session_stop", "sess_cc_01", "10:51:40", {
    title: "Session completed",
    summary: "9 files · 2 commits · 184.2k tokens · $1.74",
    metrics: { totalTokens: 184200, estimatedCostUsd: 1.74 },
  }),
];

const sessCx01Events: NormalizedAgentEvent[] = [
  ev("evt_cx_01", "codex", "session_start", "sess_cx_01", "09:31:11", {
    title: "Session started",
    summary: "gpt-5-codex · aster-agent-audit",
  }),
  ev("evt_cx_02", "codex", "user_prompt", "sess_cx_01", "09:31:48", {
    title: "Harden parser for malformed hook payloads",
    summary: "Don't trust unknown fields; normalize only known keys.",
    metrics: { inputTokens: 880 },
  }),
  ev("evt_cx_03", "codex", "pre_tool_use", "sess_cx_01", "09:38:20", {
    toolName: "exec_command",
    title: "Edit src/lib/parser.ts",
    summary: "Add zod guards and safe fallbacks.",
  }),
  ev("evt_cx_04", "codex", "file_change", "sess_cx_01", "09:40:02", {
    title: "src/lib/parser.ts",
    summary: "+71 / −33 · modified",
    metrics: { filesChanged: 1, linesAdded: 71, linesDeleted: 33 },
    links: { files: ["src/lib/parser.ts"] },
  }),
  ev("evt_cx_05", "codex", "test_result", "sess_cx_01", "09:47:39", {
    toolName: "exec_command",
    title: "pnpm test — 18 passed, 1 failed",
    summary: "parser.test.ts › rejects empty payload",
    metrics: { exitCode: 1, durationMs: 2640 },
  }),
  ev("evt_cx_forcepush", "codex", "risk_finding", "sess_cx_01", "09:52:14", {
    toolName: "exec_command",
    title: "Force push to a protected branch",
    summary: "High · git · blocked pending confirmation",
    risk: riskToFinding(findRisk("evt_cx_forcepush")!),
  }),
  ev("evt_cx_06", "codex", "git_event", "sess_cx_01", "09:56:50", {
    toolName: "exec_command",
    title: "Commit: fix(parser): guard malformed payloads",
    summary: "4 files · feat/parser-hardening",
    links: { commitSha: "7e2b1a8", branch: "feat/parser-hardening" },
  }),
  ev("evt_cx_07", "codex", "session_stop", "sess_cx_01", "09:58:25", {
    title: "Session completed",
    summary: "4 files · 1 commit · 96.4k tokens · $0.62",
    metrics: { totalTokens: 96400, estimatedCostUsd: 0.62 },
  }),
];

export const demoEventsBySession: Record<string, NormalizedAgentEvent[]> = {
  sess_cc_01: sessCc01Events,
  sess_cx_01: sessCx01Events,
};

function ev(
  id: string,
  agent: NormalizedAgentEvent["agent"],
  type: NormalizedAgentEvent["type"],
  sessionId: string,
  time: string,
  rest: Partial<
    Pick<
      NormalizedAgentEvent,
      "toolName" | "title" | "summary" | "metrics" | "risk" | "links"
    >
  > & { title: string }
): NormalizedAgentEvent {
  return {
    id,
    agent,
    source: "demo",
    type,
    sessionId,
    repoPath: REPO,
    cwd: REPO,
    timestamp: at(DEMO_TODAY, time),
    receivedAt: at(DEMO_TODAY, time),
    ...rest,
  };
}

// ----------------------------------------------------------------------------
// Repo activity (treemap, hot files, git timeline, heatmap, contribution)
// ----------------------------------------------------------------------------

const treemap: TreemapNode[] = [
  { name: "src/web", path: "src/web", churn: 312, files: 22, risk: "low" },
  { name: "src/core", path: "src/core", churn: 246, files: 7, risk: "high" },
  { name: "src/server", path: "src/server", churn: 206, files: 6, risk: "medium" },
  { name: "tests", path: "tests", churn: 185, files: 6, risk: "low" },
  { name: "src/db", path: "src/db", churn: 168, files: 4, risk: "medium" },
  { name: "src/cli", path: "src/cli", churn: 74, files: 3, risk: "info" },
  { name: "src/lib", path: "src/lib", churn: 104, files: 5, risk: "high" },
  { name: "docs", path: "docs", churn: 32, files: 3, risk: "info" },
];

const hotFiles: HotFile[] = [
  { filePath: "src/core/redaction.ts", churn: 197, linesAdded: 156, linesDeleted: 41, edits: 6, agents: ["claude-code"], maxRisk: "critical" },
  { filePath: "src/server/events.ts", churn: 132, linesAdded: 132, linesDeleted: 0, edits: 3, agents: ["claude-code"], maxRisk: "info" },
  { filePath: "src/db/index.ts", churn: 177, linesAdded: 110, linesDeleted: 67, edits: 4, agents: ["codex"], maxRisk: "medium" },
  { filePath: "src/app/dashboard.tsx", churn: 112, linesAdded: 88, linesDeleted: 24, edits: 5, agents: ["claude-code"], maxRisk: "low" },
  { filePath: "src/lib/parser.ts", churn: 104, linesAdded: 71, linesDeleted: 33, edits: 4, agents: ["codex"], maxRisk: "high" },
  { filePath: "tests/agent.test.ts", churn: 93, linesAdded: 65, linesDeleted: 28, edits: 5, agents: ["claude-code", "codex"], maxRisk: "info" },
  { filePath: "src/web/components/Treemap.tsx", churn: 90, linesAdded: 38, linesDeleted: 52, edits: 3, agents: ["codex"], maxRisk: "low" },
  { filePath: "src/web/routes/RiskRadar.tsx", churn: 76, linesAdded: 64, linesDeleted: 12, edits: 2, agents: ["claude-code"], maxRisk: "info" },
];

const gitTimeline: GitCommitNode[] = [
  { sha: "a1c9f04", message: "feat(server): session orchestration", agent: "claude-code", branch: "feat/session-orchestration", timestamp: at(DEMO_TODAY, "10:49:05"), filesChanged: 2, linesAdded: 220, linesDeleted: 28, testsPassed: 41, testsFailed: 0, isPrDraft: true },
  { sha: "7e2b1a8", message: "fix(parser): guard malformed payloads", agent: "codex", branch: "feat/parser-hardening", timestamp: at(DEMO_TODAY, "09:56:50"), filesChanged: 4, linesAdded: 100, linesDeleted: 42, testsPassed: 18, testsFailed: 1, isPrDraft: true },
  { sha: "c40d9b2", message: "refactor(core): unify redaction pipeline", agent: "claude-code", branch: "main", timestamp: at(DEMO_TODAY, "09:10:48"), filesChanged: 6, linesAdded: 248, linesDeleted: 41, testsPassed: 33, testsFailed: 0 },
  { sha: "f19a022", message: "test: stabilize flaky agent tests", agent: "claude-code", branch: "main", timestamp: at(DEMO_TODAY, "08:12:30"), filesChanged: 3, linesAdded: 36, linesDeleted: 44, testsPassed: 41, testsFailed: 0 },
  { sha: "b8c7e51", message: "chore(db): migrate to better-sqlite3", agent: "codex", branch: "main", timestamp: at(DEMO_TODAY, "06:33:02"), filesChanged: 5, linesAdded: 168, linesDeleted: 67, testsPassed: 15, testsFailed: 0 },
  { sha: "d2a6f33", message: "feat(server): SSE live updates", agent: "claude-code", branch: "main", timestamp: at(DEMO_TODAY, "07:07:40"), filesChanged: 4, linesAdded: 74, linesDeleted: 0, testsPassed: 22, testsFailed: 0, isPrDraft: true },
];

/** 18-week contribution heatmap, deterministic. Weekdays weighted higher. */
function buildHeatmap(): HeatCell[] {
  const weeks = 18;
  const cells: HeatCell[] = [];
  const rng = seeded(0xa57e2026);
  const start = new Date(`${DEMO_TODAY}T00:00:00${TZ}`);
  start.setDate(start.getDate() - (weeks * 7 - 1));
  for (let i = 0; i < weeks * 7; i++) {
    const weekday = i % 7;
    const week = Math.floor(i / 7);
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const weekendDamp = weekday === 0 || weekday === 6 ? 0.35 : 1;
    const base = rng();
    const value = Math.round(base * base * 9 * weekendDamp);
    cells.push({
      day: i,
      week,
      weekday,
      date: d.toISOString().slice(0, 10),
      value,
    });
  }
  return cells;
}

export const demoRepoActivity: RepoActivity = {
  repo: "aster-agent-audit",
  filesChanged: 42,
  churn: 1327,
  commits: 6,
  prDrafts: 3,
  testsPassing: 196,
  testsFailing: 6,
  highRiskFilesTouched: 3,
  treemap,
  hotFiles,
  gitTimeline,
  heatmap: buildHeatmap(),
  contribution: [
    { agent: "claude-code", churn: 812 },
    { agent: "codex", churn: 515 },
  ],
};

// ----------------------------------------------------------------------------
// MCP permission map + policy timeline (Risk Radar)
// ----------------------------------------------------------------------------

export const demoMcpServers: McpServer[] = [
  { id: "mcp_fs", name: "filesystem", agent: "claude-code", transport: "stdio", permissions: ["read", "write"], risk: "medium", note: "Write scope includes paths above the repo root." },
  { id: "mcp_gh", name: "github", agent: "claude-code", transport: "http", permissions: ["network", "secrets"], risk: "medium", note: "Holds a token with repo + workflow scope." },
  { id: "mcp_exec", name: "shell-exec", agent: "codex", transport: "stdio", permissions: ["exec"], risk: "high", note: "No command allowlist; arbitrary execution." },
  { id: "mcp_supabase", name: "supabase", agent: "codex", transport: "http", permissions: ["network", "read"], risk: "low", note: "Read-only project metadata." },
  { id: "mcp_fetch", name: "fetch", agent: "claude-code", transport: "http", permissions: ["network"], risk: "low", note: "General web fetch; no credentials." },
];

export const demoPolicyEvents: PolicyEvent[] = [
  { id: "pol_01", timestamp: at(DEMO_TODAY, "11:14:30"), severity: "medium", category: "mcp", title: "shell-exec exec capability widened", outcome: "flagged" },
  { id: "pol_02", timestamp: at(DEMO_TODAY, "10:23:51"), severity: "critical", category: "secrets", title: "API key redacted before storage", outcome: "blocked" },
  { id: "pol_03", timestamp: at(DEMO_TODAY, "09:52:14"), severity: "high", category: "git", title: "Force push to main intercepted", outcome: "blocked" },
  { id: "pol_04", timestamp: at(DEMO_TODAY, "09:03:47"), severity: "medium", category: "network", title: "Outbound curl during edit", outcome: "flagged" },
  { id: "pol_05", timestamp: at(DEMO_TODAY, "08:28:03"), severity: "high", category: "shell", title: "Recursive delete reviewed", outcome: "flagged" },
  { id: "pol_06", timestamp: at(DEMO_TODAY, "06:48:09"), severity: "info", category: "secrets", title: ".env read allowed", outcome: "allowed" },
];
