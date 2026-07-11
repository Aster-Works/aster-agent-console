/**
 * Aster Agent Audit — normalized event model.
 *
 * Mirrors `04_Event Schema_Aster Agent Console.md`. These types are the single
 * source of truth shared by the dashboard (Phase 1), the local collector and
 * SQLite layer (Phase 2), the CLI (Phase 3) and hook normalization (Phase 4).
 *
 * Pure types only — safe to import into the browser bundle.
 */

export type AgentName =
  | "claude-code"
  | "codex"
  | "cursor"
  | "gemini-cli"
  | "unknown";

export type EventSource = "hook" | "import" | "git_watcher" | "demo";

export type AgentEventType =
  | "session_start"
  | "user_prompt"
  | "pre_tool_use"
  | "post_tool_use"
  | "file_change"
  | "test_result"
  | "git_event"
  | "risk_finding"
  | "session_stop"
  | "error";

export type RiskSeverity = "info" | "low" | "medium" | "high" | "critical";

export type RiskCategory =
  | "secrets"
  | "shell"
  | "mcp"
  | "network"
  | "files"
  | "git"
  | "policy";

export type RedactionKind =
  | "api_key"
  | "github_token"
  | "supabase_key"
  | "jwt"
  | "private_key"
  | "env_value"
  | "url_credential"
  | "unknown_secret";

export type Redaction = {
  id: string;
  kind: RedactionKind;
  fieldPath: string;
  fingerprint: string;
  replacement: string;
};

export type RedactedJson = {
  value: unknown;
  redactions: Redaction[];
};

export type EventMetrics = {
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  filesChanged?: number;
  linesAdded?: number;
  linesDeleted?: number;
  exitCode?: number;
};

export type RiskFinding = {
  id: string;
  severity: RiskSeverity;
  category: RiskCategory;
  title: string;
  description: string;
  evidence?: string;
  redactedEvidence?: string;
  recommendedAction: string;
  ruleId: string;
};

export type EventLinks = {
  files?: string[];
  commitSha?: string;
  branch?: string;
  testRunId?: string;
  parentEventId?: string;
  relatedEventIds?: string[];
};

export type NormalizedAgentEvent = {
  id: string;
  agent: AgentName;
  source: EventSource;
  type: AgentEventType;
  sessionId: string;
  turnId?: string;
  repoPath?: string;
  cwd?: string;
  timestamp: string;
  receivedAt: string;
  model?: string;
  toolName?: string;
  title: string;
  summary?: string;
  input?: RedactedJson;
  output?: RedactedJson;
  metrics?: EventMetrics;
  risk?: RiskFinding[];
  links?: EventLinks;
  rawRef?: string;
  /**
   * Local transcript path from the hook payload (Claude Code). Transient: used
   * by the server-side usage enricher to read token counts; never persisted.
   */
  transcriptPath?: string;
};

export type SessionStatus = "active" | "completed" | "failed" | "unknown";

export type AgentSession = {
  id: string;
  agent: AgentName;
  startedAt: string;
  endedAt?: string;
  repoPath?: string;
  cwd?: string;
  model?: string;
  status: SessionStatus;
  summary?: string;
  totalTokens?: number;
  estimatedCostUsd?: number;
  /** token composition (from transcript usage), when available */
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  filesChanged?: number;
  commits?: number;
  testsPassed?: number;
  testsFailed?: number;
  riskCount?: number;
  maxRiskSeverity?: RiskSeverity;
};

export type FileChangeType = "added" | "modified" | "deleted" | "renamed";

export type FileChange = {
  id: string;
  sessionId: string;
  eventId?: string;
  repoPath: string;
  filePath: string;
  changeType: FileChangeType;
  linesAdded: number;
  linesDeleted: number;
  agent: AgentName;
  timestamp: string;
};

/** Aggregate snapshot consumed by the Overview screen. */
export type OverviewSnapshot = {
  generatedAt: string;
  range: { from: string; to: string; label: string };
  totals: {
    sessions: number;
    tokens: number;
    costUsd: number;
    filesChanged: number;
    toolCalls: number;
    riskFindings: number;
    testsPassing: number;
    testsFailing: number;
    commits: number;
  };
  perAgent: AgentRollup[];
  activitySeries: ActivityPoint[];
  costByRepo: { repo: string; costUsd: number }[];
  riskByCategory: { category: RiskCategory; count: number }[];
};

export type AgentRollup = {
  agent: AgentName;
  sessions: number;
  tokens: number;
  costUsd: number;
  filesChanged: number;
  toolCalls: number;
  commits: number;
  testsPassed: number;
  testsFailed: number;
  riskFindings: number;
  successRate: number; // 0..1
  spark: number[];
};

export type ActivityPoint = {
  /** ISO time bucket (hour). */
  t: string;
  label: string;
  claude: number;
  codex: number;
  risk: number;
};

/** Collector / dashboard runtime status surfaced in the top bar. */
export type CollectorStatus = {
  mode: "demo" | "live";
  online: boolean;
  host: string;
  port: number;
  dbPath: string;
  spooledEvents: number;
  lastEventAt?: string;
};

export const SEVERITY_ORDER: RiskSeverity[] = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
];

export const RISK_CATEGORIES: RiskCategory[] = [
  "secrets",
  "shell",
  "mcp",
  "network",
  "files",
  "git",
];

export const AGENT_LABELS: Record<AgentName, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  "gemini-cli": "Gemini CLI",
  unknown: "Unknown",
};
