/**
 * SQLite persistence (04 §7) via better-sqlite3. Synchronous, local-only.
 * Tables: sessions, events, risk_findings, file_changes. The risk_findings and
 * file_changes tables carry a few extra columns (agent, timestamp, status) so
 * the Risk Radar / Repo Activity views can be served without joins.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type {
  AgentSession,
  FileChange,
  NormalizedAgentEvent,
  RiskFinding,
  SessionStatus,
} from "../core/types";
import type { GitCommitNode, RiskRow } from "../core/views";
import { DATA_DIR_NAME, DB_FILE_NAME, LEGACY_DATA_DIR_NAME } from "../core/branding";
import { CHAIN_GENESIS, computeEventHash, type ChainedEvent } from "../core/integrity/index";

/**
 * Data-directory resolution with legacy fallback (REFACTOR_PLAN.md D2):
 * use `~/.aster-agent-audit` once it exists, otherwise keep using the legacy
 * `~/.aster-agent-console`. Nothing is copied or moved automatically — the
 * legacy directory holds a live spool and a 50MB-class DB, and only the
 * explicit `migrate` command may touch it. A fresh install (neither dir
 * exists) starts on the new name.
 */
export function resolveConfigDir(home: string = homedir()): string {
  const next = join(home, DATA_DIR_NAME);
  if (existsSync(next)) return next;
  const legacy = join(home, LEGACY_DATA_DIR_NAME);
  if (existsSync(legacy)) return legacy;
  return next;
}

export const DEFAULT_CONFIG_DIR = resolveConfigDir();
export const DEFAULT_DB_PATH = join(DEFAULT_CONFIG_DIR, DB_FILE_NAME);

const SCHEMA = `
create table if not exists sessions (
  id text primary key,
  agent text not null,
  started_at text not null,
  ended_at text,
  repo_path text,
  cwd text,
  model text,
  status text not null default 'unknown',
  summary text,
  total_tokens integer,
  estimated_cost_usd real,
  input_tokens integer,
  output_tokens integer,
  cached_input_tokens integer,
  cache_write_tokens integer,
  files_changed integer default 0,
  commits integer default 0,
  tests_passed integer default 0,
  tests_failed integer default 0,
  risk_count integer default 0,
  max_risk_severity text,
  created_at text not null,
  updated_at text not null
);

create table if not exists events (
  id text primary key,
  session_id text not null,
  agent text not null,
  source text not null,
  type text not null,
  turn_id text,
  repo_path text,
  cwd text,
  timestamp text not null,
  received_at text not null,
  model text,
  tool_name text,
  title text not null,
  summary text,
  input_json text,
  output_json text,
  metrics_json text,
  links_json text,
  raw_ref text,
  created_at text not null
);

create table if not exists risk_findings (
  id text primary key,
  event_id text,
  session_id text not null,
  agent text,
  severity text not null,
  category text not null,
  title text not null,
  description text not null,
  redacted_evidence text,
  recommended_action text not null,
  rule_id text not null,
  repo_path text,
  timestamp text not null,
  status text not null default 'open',
  created_at text not null
);

create table if not exists file_changes (
  id text primary key,
  session_id text not null,
  event_id text,
  repo_path text not null,
  file_path text not null,
  change_type text,
  lines_added integer default 0,
  lines_deleted integer default 0,
  agent text,
  timestamp text not null,
  created_at text not null
);

create index if not exists idx_events_session on events(session_id);
create index if not exists idx_events_type on events(type);
create index if not exists idx_risk_session on risk_findings(session_id);
create index if not exists idx_files_session on file_changes(session_id);
`;

const SEV_RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const RANK_SEV = ["info", "low", "medium", "high", "critical"] as const;

function now(): string {
  return new Date().toISOString();
}

export type AgentConsoleDb = ReturnType<typeof openDb>;

export function openDb(dbPath: string = DEFAULT_DB_PATH) {
  const dir = dirname(dbPath);
  if (dbPath !== ":memory:" && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  const raw = new Database(dbPath);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.pragma("busy_timeout = 3000");
  raw.exec(SCHEMA);

  // ---- versioned migrations (PRAGMA user_version) --------------------------
  // v1 = the pre-versioning baseline: idempotent SCHEMA above plus the
  //      usage-breakdown columns probe (kept as-is so any old DB reaches v1).
  // v2 = audit-integrity columns on events: prev_hash / hash (the chain) and
  //      chain_seq (insert order; rowid is unusable because `insert or
  //      replace` re-inserts rows at a new rowid). Existing rows keep NULLs
  //      and verify as "legacy-unverified".
  const sessionCols = new Set(
    (raw.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]).map((c) => c.name)
  );
  for (const col of ["input_tokens", "output_tokens", "cached_input_tokens", "cache_write_tokens"]) {
    if (!sessionCols.has(col)) raw.exec(`alter table sessions add column ${col} integer`);
  }

  const userVersion = raw.pragma("user_version", { simple: true }) as number;
  if (userVersion < 2) {
    const eventCols = new Set(
      (raw.prepare(`PRAGMA table_info(events)`).all() as { name: string }[]).map((c) => c.name)
    );
    // Column probes keep this re-runnable even if user_version was lost.
    if (!eventCols.has("prev_hash")) raw.exec(`alter table events add column prev_hash text`);
    if (!eventCols.has("hash")) raw.exec(`alter table events add column hash text`);
    if (!eventCols.has("chain_seq")) raw.exec(`alter table events add column chain_seq integer`);
    raw.exec(`create index if not exists idx_events_chain on events(session_id, chain_seq)`);
    raw.pragma("user_version = 2");
  }

  // ---- sessions ----------------------------------------------------------
  const upsertSessionStmt = raw.prepare(`
    insert into sessions (id, agent, started_at, repo_path, cwd, model, status, summary, created_at, updated_at)
    values (@id, @agent, @started_at, @repo_path, @cwd, @model, @status, @summary, @created_at, @updated_at)
    on conflict(id) do update set
      ended_at = coalesce(excluded.ended_at, sessions.ended_at),
      repo_path = coalesce(excluded.repo_path, sessions.repo_path),
      cwd = coalesce(excluded.cwd, sessions.cwd),
      model = coalesce(excluded.model, sessions.model),
      summary = coalesce(excluded.summary, sessions.summary),
      updated_at = excluded.updated_at
  `);

  function upsertSession(s: {
    id: string;
    agent: string;
    startedAt: string;
    repoPath?: string;
    cwd?: string;
    model?: string;
    status?: SessionStatus;
    summary?: string;
  }) {
    const ts = now();
    upsertSessionStmt.run({
      id: s.id,
      agent: s.agent,
      started_at: s.startedAt,
      repo_path: s.repoPath ?? null,
      cwd: s.cwd ?? null,
      model: s.model ?? null,
      status: s.status ?? "active",
      summary: s.summary ?? null,
      created_at: ts,
      updated_at: ts,
    });
  }

  // ---- events ------------------------------------------------------------
  const insertEventStmt = raw.prepare(`
    insert or replace into events
      (id, session_id, agent, source, type, turn_id, repo_path, cwd, timestamp, received_at,
       model, tool_name, title, summary, input_json, output_json, metrics_json, links_json, raw_ref, created_at,
       prev_hash, hash, chain_seq)
    values
      (@id, @session_id, @agent, @source, @type, @turn_id, @repo_path, @cwd, @timestamp, @received_at,
       @model, @tool_name, @title, @summary, @input_json, @output_json, @metrics_json, @links_json, @raw_ref, @created_at,
       @prev_hash, @hash, @chain_seq)
  `);
  const chainStateStmt = raw.prepare(
    `select prev_hash, chain_seq from events where id = ?`
  );
  const chainTipStmt = raw.prepare(
    `select hash, chain_seq from events
      where session_id = ? and hash is not null
      order by chain_seq desc limit 1`
  );

  /**
   * Hash-chain link for a new or re-ingested event.
   *  - New event: link after the session's current tip.
   *  - Re-ingest of a known id (`insert or replace`, e.g. Codex re-import
   *    after a cursor loss): keep its ORIGINAL slot and predecessor, so an
   *    identical payload re-hashes identically and the chain stays intact —
   *    while a changed payload yields a different hash that `verify` reports
   *    as a break at the next link. Idempotent by design, tamper-evident by
   *    consequence.
   */
  function chainLink(e: NormalizedAgentEvent): { prev_hash: string; hash: string; chain_seq: number } {
    const existing = chainStateStmt.get(e.id) as { prev_hash: string | null; chain_seq: number | null } | undefined;
    if (existing && existing.chain_seq !== null) {
      const prev = existing.prev_hash ?? CHAIN_GENESIS;
      return {
        prev_hash: prev,
        hash: computeEventHash(e, prev === CHAIN_GENESIS ? null : prev),
        chain_seq: existing.chain_seq,
      };
    }
    const tip = chainTipStmt.get(e.sessionId) as { hash: string; chain_seq: number } | undefined;
    const prev = tip?.hash ?? null;
    return {
      prev_hash: prev ?? CHAIN_GENESIS,
      hash: computeEventHash(e, prev),
      chain_seq: (tip?.chain_seq ?? 0) + 1,
    };
  }

  function insertEvent(e: NormalizedAgentEvent) {
    const link = chainLink(e);
    insertEventStmt.run({
      ...link,
      id: e.id,
      session_id: e.sessionId,
      agent: e.agent,
      source: e.source,
      type: e.type,
      turn_id: e.turnId ?? null,
      repo_path: e.repoPath ?? null,
      cwd: e.cwd ?? null,
      timestamp: e.timestamp,
      received_at: e.receivedAt,
      model: e.model ?? null,
      tool_name: e.toolName ?? null,
      title: e.title,
      summary: e.summary ?? null,
      input_json: e.input ? JSON.stringify(e.input) : null,
      output_json: e.output ? JSON.stringify(e.output) : null,
      metrics_json: e.metrics ? JSON.stringify(e.metrics) : null,
      links_json: e.links ? JSON.stringify(e.links) : null,
      raw_ref: e.rawRef ?? null,
      created_at: now(),
    });
  }

  // ---- risk --------------------------------------------------------------
  const insertRiskStmt = raw.prepare(`
    insert or replace into risk_findings
      (id, event_id, session_id, agent, severity, category, title, description,
       redacted_evidence, recommended_action, rule_id, repo_path, timestamp, status, created_at)
    values
      (@id, @event_id, @session_id, @agent, @severity, @category, @title, @description,
       @redacted_evidence, @recommended_action, @rule_id, @repo_path, @timestamp, @status, @created_at)
  `);

  function insertRisk(
    f: RiskFinding,
    ctx: { eventId?: string; sessionId: string; agent: string; repoPath?: string; timestamp: string }
  ) {
    insertRiskStmt.run({
      id: `${ctx.sessionId}:${f.id}`,
      event_id: ctx.eventId ?? null,
      session_id: ctx.sessionId,
      agent: ctx.agent,
      severity: f.severity,
      category: f.category,
      title: f.title,
      description: f.description,
      redacted_evidence: f.redactedEvidence ?? null,
      recommended_action: f.recommendedAction,
      rule_id: f.ruleId,
      repo_path: ctx.repoPath ?? null,
      timestamp: ctx.timestamp,
      status: "open",
      created_at: now(),
    });
  }

  // ---- file changes ------------------------------------------------------
  const insertFileStmt = raw.prepare(`
    insert or replace into file_changes
      (id, session_id, event_id, repo_path, file_path, change_type, lines_added, lines_deleted, agent, timestamp, created_at)
    values
      (@id, @session_id, @event_id, @repo_path, @file_path, @change_type, @lines_added, @lines_deleted, @agent, @timestamp, @created_at)
  `);

  function insertFileChange(fc: FileChange) {
    insertFileStmt.run({
      id: fc.id,
      session_id: fc.sessionId,
      event_id: fc.eventId ?? null,
      repo_path: fc.repoPath,
      file_path: fc.filePath,
      change_type: fc.changeType,
      lines_added: fc.linesAdded,
      lines_deleted: fc.linesDeleted,
      agent: fc.agent,
      timestamp: fc.timestamp,
      created_at: now(),
    });
  }

  // ---- enrichment updates (Phase 5) -------------------------------------
  const updateFileStatsStmt = raw.prepare(
    `update file_changes set lines_added = @a, lines_deleted = @d where id = @id`
  );
  function updateFileChangeStats(id: string, linesAdded: number, linesDeleted: number) {
    updateFileStatsStmt.run({ id, a: linesAdded, d: linesDeleted });
  }

  // Token/cost usage comes from transcript enrichment, not event metrics, so it
  // is written straight onto the session (recomputeSession preserves it).
  const updateUsageStmt = raw.prepare(
    `update sessions set
       total_tokens = @tokens,
       estimated_cost_usd = @cost,
       input_tokens = @input,
       output_tokens = @output,
       cached_input_tokens = @cached,
       cache_write_tokens = @cacheWrite,
       model = coalesce(@model, model),
       updated_at = @upd
     where id = @id`
  );
  function updateSessionUsage(
    sessionId: string,
    u: {
      totalTokens: number;
      costUsd: number;
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      cachedInputTokens?: number;
      cacheWriteTokens?: number;
    }
  ) {
    updateUsageStmt.run({
      id: sessionId,
      tokens: u.totalTokens > 0 ? u.totalTokens : null,
      cost: u.costUsd > 0 ? u.costUsd : null,
      input: u.inputTokens ?? null,
      output: u.outputTokens ?? null,
      cached: u.cachedInputTokens ?? null,
      cacheWrite: u.cacheWriteTokens ?? null,
      model: u.model ?? null,
      upd: now(),
    });
  }

  const enrichEventStmt = raw.prepare(
    `update events set links_json = @links, metrics_json = @metrics,
       title = coalesce(@title, title) where id = @id`
  );
  function enrichEvent(
    eventId: string,
    linksJson: string | null,
    metricsJson: string | null,
    title?: string
  ) {
    enrichEventStmt.run({ id: eventId, links: linksJson, metrics: metricsJson, title: title ?? null });
  }

  // Committed file rows supersede earlier working-tree rows for the same paths,
  // so a file edited then committed is not counted twice.
  const deleteFcStmt = raw.prepare(
    `delete from file_changes
       where session_id = @sid and file_path = @path
         and (event_id is null or event_id != @keep)`
  );
  function deleteSupersededFileChanges(sessionId: string, paths: string[], keepEventId: string) {
    for (const path of paths) deleteFcStmt.run({ sid: sessionId, path, keep: keepEventId });
  }

  // ---- finding resolution (user marks a reviewed finding on Risk Radar) --
  const resolveRiskStmt = raw.prepare(
    `update risk_findings set status = @status where id = @id`
  );
  /** Mark a finding resolved/acknowledged, or reopen it. Returns its session id.
   *  Findings are never deleted — the honest audit record is kept; "resolved"
   *  just drops it from the active radar and marks it as handled. */
  function setRiskStatus(id: string, status: "open" | "acknowledged" | "resolved"): string | undefined {
    const row = raw.prepare(`select session_id from risk_findings where id = ?`).get(id) as
      | { session_id: string }
      | undefined;
    if (!row) return undefined;
    resolveRiskStmt.run({ id, status });
    return row.session_id;
  }

  // ---- aggregates --------------------------------------------------------
  function recomputeSession(sessionId: string) {
    const agg = raw
      .prepare(
        `select
           (select count(distinct file_path) from file_changes where session_id = @sid) as files_changed,
           (select count(*) from events where session_id = @sid and type = 'git_event') as commits,
           (select count(*) from risk_findings where session_id = @sid) as risk_count,
           (select min(timestamp) from events where session_id = @sid) as first_ts,
           (select max(timestamp) from events where session_id = @sid) as last_ts`
      )
      .get({ sid: sessionId }) as Record<string, number | string | null>;

    const metricsRows = raw
      .prepare(`select metrics_json, type from events where session_id = @sid`)
      .all({ sid: sessionId }) as { metrics_json: string | null; type: string }[];

    let tokens = 0;
    let cost = 0;
    let testsPassed = 0;
    let testsFailed = 0;
    let hasStop = false;
    for (const row of metricsRows) {
      if (row.type === "session_stop") hasStop = true;
      let m: { totalTokens?: number; estimatedCostUsd?: number; exitCode?: number } = {};
      if (row.metrics_json) {
        try {
          m = JSON.parse(row.metrics_json);
        } catch {
          m = {};
        }
      }
      if (typeof m.totalTokens === "number") tokens += m.totalTokens;
      if (typeof m.estimatedCostUsd === "number") cost += m.estimatedCostUsd;
      if (row.type === "test_result") {
        // A missing exit code counts as a pass (matches parseTestResult).
        if (typeof m.exitCode === "number" && m.exitCode !== 0) testsFailed += 1;
        else testsPassed += 1;
      }
    }

    const sevRow = raw
      .prepare(`select severity from risk_findings where session_id = @sid`)
      .all({ sid: sessionId }) as { severity: string }[];
    let maxRank = -1;
    for (const r of sevRow) maxRank = Math.max(maxRank, SEV_RANK[r.severity] ?? -1);
    const maxSev = maxRank >= 0 ? RANK_SEV[maxRank] : null;

    const hasFail = raw
      .prepare(`select count(*) as c from events where session_id = @sid and type = 'error'`)
      .get({ sid: sessionId }) as { c: number };
    const status: SessionStatus = hasFail.c > 0 ? "failed" : hasStop ? "completed" : "active";

    raw
      .prepare(
        `update sessions set
           files_changed = @files, commits = @commits, risk_count = @risk,
           tests_passed = @tp, tests_failed = @tf,
           total_tokens = case when @tokens > 0 then @tokens else total_tokens end,
           estimated_cost_usd = case when @cost > 0 then @cost else estimated_cost_usd end,
           max_risk_severity = @maxsev, status = @status,
           ended_at = case when @status = 'active' then ended_at else @last end,
           updated_at = @upd
         where id = @sid`
      )
      .run({
        sid: sessionId,
        files: Number(agg.files_changed) || 0,
        commits: Number(agg.commits) || 0,
        risk: Number(agg.risk_count) || 0,
        tp: testsPassed,
        tf: testsFailed,
        tokens: tokens,
        cost: cost,
        maxsev: maxSev,
        status,
        last: agg.last_ts ?? null,
        upd: now(),
      });
  }

  // ---- queries -----------------------------------------------------------
  function getSessions(): AgentSession[] {
    const rows = raw
      .prepare(`select * from sessions order by started_at desc`)
      .all() as Record<string, unknown>[];
    return rows.map(rowToSession);
  }

  function getSession(id: string): AgentSession | undefined {
    const row = raw.prepare(`select * from sessions where id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToSession(row) : undefined;
  }

  function getEvents(sessionId: string): NormalizedAgentEvent[] {
    const rows = raw
      .prepare(`select * from events where session_id = ? order by timestamp asc`)
      .all(sessionId) as Record<string, unknown>[];
    return rows.map(rowToEvent);
  }

  function getEventsBySession(): Record<string, NormalizedAgentEvent[]> {
    const rows = raw
      .prepare(`select * from events order by timestamp asc`)
      .all() as Record<string, unknown>[];
    const out: Record<string, NormalizedAgentEvent[]> = {};
    for (const r of rows) {
      const e = rowToEvent(r);
      (out[e.sessionId] ??= []).push(e);
    }
    return out;
  }

  function getRisk(): RiskRow[] {
    const rows = raw
      .prepare(`select * from risk_findings order by timestamp desc`)
      .all() as Record<string, unknown>[];
    return rows.map(rowToRisk);
  }

  function getFileChanges(): FileChange[] {
    const rows = raw
      .prepare(`select * from file_changes order by timestamp asc`)
      .all() as Record<string, unknown>[];
    return rows.map(rowToFileChange);
  }

  function getGitCommits(): GitCommitNode[] {
    const rows = raw
      .prepare(`select * from events where type = 'git_event' order by timestamp desc`)
      .all() as Record<string, unknown>[];
    return rows.map((r) => {
      const links = r.links_json ? JSON.parse(r.links_json as string) : {};
      const metrics = r.metrics_json ? JSON.parse(r.metrics_json as string) : {};
      return {
        sha: (links.commitSha as string) ?? String(r.id).slice(0, 7),
        message: String(r.title),
        agent: r.agent as GitCommitNode["agent"],
        branch: (links.branch as string) ?? "main",
        timestamp: String(r.timestamp),
        filesChanged: (metrics.filesChanged as number) ?? 0,
        linesAdded: (metrics.linesAdded as number) ?? 0,
        linesDeleted: (metrics.linesDeleted as number) ?? 0,
        isPrDraft: Boolean(
          links.branch &&
            !["main", "master", "develop", "detached"].includes(links.branch as string)
        ),
      } as GitCommitNode;
    });
  }

  // Retention: drop history older than `days`. Runs on collector start and on a
  // timer so the local DB doesn't grow without bound.
  const pruneStmts = {
    events: raw.prepare(`delete from events where timestamp < ?`),
    risk: raw.prepare(`delete from risk_findings where timestamp < ?`),
    files: raw.prepare(`delete from file_changes where timestamp < ?`),
    sessions: raw.prepare(`delete from sessions where started_at < ?`),
  };
  const pruneTxn = raw.transaction((cutoff: string) => {
    const e = pruneStmts.events.run(cutoff).changes;
    pruneStmts.risk.run(cutoff);
    pruneStmts.files.run(cutoff);
    const s = pruneStmts.sessions.run(cutoff).changes;
    return e + s;
  });
  function pruneOlderThan(days: number): number {
    if (!Number.isFinite(days) || days <= 0) return 0;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return pruneTxn(cutoff);
  }

  function counts() {
    const c = (t: string) => (raw.prepare(`select count(*) as c from ${t}`).get() as { c: number }).c;
    return {
      sessions: c("sessions"),
      events: c("events"),
      risk: c("risk_findings"),
      fileChanges: c("file_changes"),
    };
  }

  function close() {
    raw.close();
  }

  /**
   * One session's events in CHAIN order for verification: legacy rows
   * (chain_seq null → NULLS FIRST by SQLite default asc) precede hashed
   * rows, matching verifyChain's expected stream shape.
   */
  function integrityRows(sessionId: string): ChainedEvent[] {
    const rows = raw
      .prepare(`select * from events where session_id = ? order by chain_seq asc, timestamp asc`)
      .all(sessionId) as Record<string, unknown>[];
    return rows.map((r) => ({
      event: rowToEvent(r),
      prevHash: (r.prev_hash as string) ?? null,
      hash: (r.hash as string) ?? null,
    }));
  }

  function sessionIds(): string[] {
    return (raw.prepare(`select distinct session_id as id from events order by id`).all() as { id: string }[]).map(
      (r) => r.id
    );
  }

  return {
    raw,
    upsertSession,
    insertEvent,
    integrityRows,
    sessionIds,
    insertRisk,
    insertFileChange,
    updateFileChangeStats,
    updateSessionUsage,
    enrichEvent,
    deleteSupersededFileChanges,
    setRiskStatus,
    recomputeSession,
    getSessions,
    getSession,
    getEvents,
    getEventsBySession,
    getRisk,
    getFileChanges,
    getGitCommits,
    pruneOlderThan,
    counts,
    close,
  };
}

// ---- row mappers ----------------------------------------------------------

function rowToSession(r: Record<string, unknown>): AgentSession {
  return {
    id: String(r.id),
    agent: r.agent as AgentSession["agent"],
    startedAt: String(r.started_at),
    endedAt: (r.ended_at as string) ?? undefined,
    repoPath: (r.repo_path as string) ?? undefined,
    cwd: (r.cwd as string) ?? undefined,
    model: (r.model as string) ?? undefined,
    status: r.status as SessionStatus,
    summary: (r.summary as string) ?? undefined,
    totalTokens: (r.total_tokens as number) ?? undefined,
    estimatedCostUsd: (r.estimated_cost_usd as number) ?? undefined,
    inputTokens: (r.input_tokens as number) ?? undefined,
    outputTokens: (r.output_tokens as number) ?? undefined,
    cachedInputTokens: (r.cached_input_tokens as number) ?? undefined,
    cacheWriteTokens: (r.cache_write_tokens as number) ?? undefined,
    filesChanged: (r.files_changed as number) ?? 0,
    commits: (r.commits as number) ?? 0,
    testsPassed: (r.tests_passed as number) ?? 0,
    testsFailed: (r.tests_failed as number) ?? 0,
    riskCount: (r.risk_count as number) ?? 0,
    maxRiskSeverity: (r.max_risk_severity as AgentSession["maxRiskSeverity"]) ?? undefined,
  };
}

function rowToEvent(r: Record<string, unknown>): NormalizedAgentEvent {
  const json = (v: unknown) => (v ? JSON.parse(v as string) : undefined);
  return {
    id: String(r.id),
    agent: r.agent as NormalizedAgentEvent["agent"],
    source: r.source as NormalizedAgentEvent["source"],
    type: r.type as NormalizedAgentEvent["type"],
    sessionId: String(r.session_id),
    turnId: (r.turn_id as string) ?? undefined,
    repoPath: (r.repo_path as string) ?? undefined,
    cwd: (r.cwd as string) ?? undefined,
    timestamp: String(r.timestamp),
    receivedAt: String(r.received_at),
    model: (r.model as string) ?? undefined,
    toolName: (r.tool_name as string) ?? undefined,
    title: String(r.title),
    summary: (r.summary as string) ?? undefined,
    input: json(r.input_json),
    output: json(r.output_json),
    metrics: json(r.metrics_json),
    links: json(r.links_json),
    rawRef: (r.raw_ref as string) ?? undefined,
  };
}

function rowToRisk(r: Record<string, unknown>): RiskRow {
  return {
    id: String(r.id),
    ruleId: String(r.rule_id),
    severity: r.severity as RiskRow["severity"],
    category: r.category as RiskRow["category"],
    title: String(r.title),
    description: String(r.description),
    redactedEvidence: (r.redacted_evidence as string) ?? undefined,
    recommendedAction: String(r.recommended_action),
    agent: (r.agent as RiskRow["agent"]) ?? "unknown",
    sessionId: String(r.session_id),
    eventId: (r.event_id as string) ?? undefined,
    repoPath: (r.repo_path as string) ?? undefined,
    timestamp: String(r.timestamp),
    status: (r.status as RiskRow["status"]) ?? "open",
  };
}

function rowToFileChange(r: Record<string, unknown>): FileChange {
  return {
    id: String(r.id),
    sessionId: String(r.session_id),
    eventId: (r.event_id as string) ?? undefined,
    repoPath: String(r.repo_path),
    filePath: String(r.file_path),
    changeType: (r.change_type as FileChange["changeType"]) ?? "modified",
    linesAdded: (r.lines_added as number) ?? 0,
    linesDeleted: (r.lines_deleted as number) ?? 0,
    agent: (r.agent as FileChange["agent"]) ?? "unknown",
    timestamp: String(r.timestamp),
  };
}
