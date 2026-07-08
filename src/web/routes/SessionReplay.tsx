import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Check,
  ChevronDown,
  Clock,
  FileCode2,
  FlaskConical,
  GitBranch,
  MessageSquare,
  Play,
  ShieldAlert,
  TerminalSquare,
  User,
  Zap,
} from "lucide-react";
import type {
  AgentSession,
  NormalizedAgentEvent,
  RiskCategory,
} from "@core/types";
import { AGENT_LABELS } from "@core/types";
import { useAppStore } from "../app/store";
import { KeyValue, EmptyState, Pill } from "../components/ui";
import { AgentBadge } from "../components/AgentBadge";
import { RiskBadge, CategoryChip } from "../components/RiskBadge";
import { CommandBlock } from "../components/CommandBlock";
import { DiffViewer, type DiffLine } from "../components/DiffViewer";
import { cn } from "../lib/cn";
import { useT } from "../lib/i18n";
import { describeEvent, eventCommand, isCompletion } from "../lib/describe";
import {
  AGENT_COLOR_VAR,
  formatClock,
  formatDuration,
  durationBetween,
  formatTokens,
  formatUsd,
} from "../lib/format";

type TrackKey = "user" | "agent" | "shell" | "files" | "tests" | "git";

// Vertical timeline: lanes are columns (lifelines), time flows top → bottom,
// each event is a dot on its lane with a pill extending to the right.
const PX_PER_MIN = 24; // vertical px per elapsed minute
const MIN_GAP = 38; // never let two event rows overlap
const LANE_W = 60; // horizontal spacing between lane lines
const LANE_GUTTER = 56; // left gutter (clock labels) before the first lane
const HEADER_H = 34;
const MIN_W = 560;

export function SessionReplay() {
  const t = useT();
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const dataset = useAppStore((s) => s.dataset);
  const sessions = dataset.sessions;

  const session =
    sessions.find((s) => s.id === sessionId) ??
    sessions.find((s) => dataset.eventsBySession[s.id]) ??
    sessions[0];

  const events = dataset.eventsBySession[session.id] ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(
    events.find((e) => e.type === "file_change")?.id ?? events[1]?.id ?? events[0]?.id ?? null
  );
  const selected = events.find((e) => e.id === selectedId) ?? events[0] ?? null;

  const tracks: { key: TrackKey; label: string; icon: typeof User; color: string }[] = [
    { key: "user", label: t("User"), icon: User, color: "var(--color-ink-2)" },
    { key: "agent", label: AGENT_LABELS[session.agent], icon: Zap, color: AGENT_COLOR_VAR[session.agent] },
    { key: "shell", label: t("Shell"), icon: TerminalSquare, color: "var(--color-warn)" },
    { key: "files", label: t("Files"), icon: FileCode2, color: "var(--color-info)" },
    { key: "tests", label: t("Tests"), icon: FlaskConical, color: "var(--color-safe)" },
    { key: "git", label: t("Git"), icon: GitBranch, color: "var(--color-cursor)" },
  ];

  const start = new Date(session.startedAt).getTime();
  const laneX = (i: number) => LANE_GUTTER + i * LANE_W;
  const laneOf = (e: NormalizedAgentEvent) =>
    Math.max(0, tracks.findIndex((tr) => tr.key === trackForEvent(e, session.agent)));

  // Time flows downward. Events are declustered GLOBALLY (not per-lane) because
  // a pill spans to the right edge — two events sharing a y would overlap.
  const layoutY = useMemo(() => {
    const map = new Map<string, number>();
    let prev = -Infinity;
    for (const e of [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )) {
      const timeY = ((new Date(e.timestamp).getTime() - start) / 60000) * PX_PER_MIN + 22;
      const y = Math.max(timeY, prev + MIN_GAP);
      map.set(e.id, y);
      prev = y;
    }
    return map;
  }, [events, start]);

  const contentH = (layoutY.size ? Math.max(...layoutY.values()) : 0) + 56;
  const selectedY = selected ? layoutY.get(selected.id) ?? 0 : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Session header */}
      <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <SessionPicker sessions={sessions} current={session} onPick={(id) => { setSelectedId(null); navigate(`/session-replay/${id}`); }} />
          <div className="hidden items-center gap-2 text-[11px] text-ink-3 md:flex">
            <AgentBadge agent={session.agent} />
            <span className="font-mono">{session.model}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-ink-3">
          <Pill>{durationBetween(session.startedAt, session.endedAt)}</Pill>
          <Pill>{t("{n} files", { n: session.filesChanged ?? 0 })}</Pill>
          <Pill>{t("{n} tok", { n: formatTokens(session.totalTokens ?? 0) })}</Pill>
          <Pill>{formatUsd(session.estimatedCostUsd ?? 0)}</Pill>
          {session.riskCount ? (
            <Pill color="var(--color-warn)">
              <ShieldAlert size={11} /> {session.riskCount}
            </Pill>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Timeline */}
        <div className="flex min-w-0 flex-1 flex-col">
          {events.length === 0 ? (
            <EmptyState icon={Play} title={t("No detailed events for this session")}>
              {t("Pick a session with a recorded timeline (e.g. “Implement session orchestration”).")}
            </EmptyState>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
              {/* Lane headers — stay pinned while the timeline scrolls down */}
              <div
                className="sticky top-0 z-30 border-b border-line bg-surface"
                style={{ height: HEADER_H, minWidth: MIN_W }}
              >
                {tracks.map((tr, i) => (
                  <div
                    key={tr.key}
                    className="absolute top-0 flex h-full items-center gap-1"
                    style={{ left: laneX(i) - 5 }}
                  >
                    <tr.icon size={11} className="shrink-0" style={{ color: tr.color }} />
                    <span className="whitespace-nowrap text-[10px] font-medium text-ink-2">
                      {t(tr.label)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Canvas: lifelines + event rows */}
              <div className="relative" style={{ height: contentH, minWidth: MIN_W }}>
                {/* Lifelines (vertical). Drawn ABOVE the pills so a lane reads as
                    one continuous line running through the events it owns. */}
                {tracks.map((tr, i) => (
                  <div
                    key={tr.key}
                    className="pointer-events-none absolute bottom-0 top-0 z-[15] w-px bg-line"
                    style={{ left: laneX(i) }}
                  />
                ))}

                {/* Playhead (horizontal, at the selected event) */}
                {selected && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-10 h-px"
                    style={{ top: selectedY, background: "var(--color-sel)" }}
                  />
                )}

                {events.map((e) => {
                  const i = laneOf(e);
                  const y = layoutY.get(e.id) ?? 0;
                  const tr = tracks[i];
                  return (
                    <div key={e.id}>
                      {/* elapsed clock in the left gutter */}
                      <span
                        className="aac-tnum pointer-events-none absolute -translate-y-1/2 text-[9px] text-ink-3"
                        style={{ left: 4, top: y }}
                      >
                        {formatClock(e.timestamp)}
                      </span>
                      {/* dot on the lifeline */}
                      <span
                        className="pointer-events-none absolute z-30 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-bg"
                        style={{ left: laneX(i), top: y, borderColor: tr.color }}
                      />
                      <EventPill
                        event={e}
                        top={y}
                        left={laneX(i) + 12}
                        color={tr.color}
                        selected={e.id === selectedId}
                        onClick={() => setSelectedId(e.id)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Playback controls */}
          <PlaybackBar
            events={events}
            selectedId={selectedId}
            onSelect={setSelectedId}
            clock={selected ? formatClock(selected.timestamp) : "--:--:--"}
          />
        </div>

        {/* Inspector */}
        <aside className="hidden w-[380px] shrink-0 overflow-y-auto border-l border-line bg-surface lg:block 2xl:w-[420px]">
          {selected ? (
            <EventInspector event={selected} session={session} />
          ) : (
            <EmptyState icon={MessageSquare} title={t("Select an event")}>
              {t("Click any event on the timeline to inspect its input, output, diff, and risk.")}
            </EmptyState>
          )}
        </aside>
      </div>
    </div>
  );
}

function trackForEvent(e: NormalizedAgentEvent, _agent: string): TrackKey {
  switch (e.type) {
    case "session_start":
    case "session_stop":
    case "user_prompt":
      return "user";
    case "file_change":
      return "files";
    case "test_result":
      return "tests";
    case "git_event":
      return "git";
    case "risk_finding": {
      const cat = e.risk?.[0]?.category as RiskCategory | undefined;
      if (cat === "git") return "git";
      if (cat === "files") return "files";
      if (cat === "shell" || cat === "secrets") return "shell";
      return "agent";
    }
    default: {
      const tool = (e.toolName ?? "").toLowerCase();
      if (/bash|exec|shell|command/.test(tool)) return "shell";
      return "agent";
    }
  }
}

function EventPill({
  event,
  top,
  left,
  color,
  selected,
  onClick,
}: {
  event: NormalizedAgentEvent;
  top: number;
  left: number;
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  const isRisk = event.type === "risk_finding";
  const sev = event.risk?.[0]?.severity;
  const ring = isRisk ? "var(--color-danger)" : selected ? "var(--color-sel)" : "transparent";
  // WHAT the agent did — the command/file, not "Bash complete".
  const { what } = describeEvent(event);
  const done = isCompletion(event);
  const exit = event.metrics?.exitCode;
  return (
    <button
      type="button"
      onClick={onClick}
      title={what}
      className="absolute z-10 flex -translate-y-1/2 items-center gap-1 rounded-md border px-2 py-1 text-left text-[11px] transition-colors hover:z-20"
      style={{
        top,
        left,
        right: 12,
        color: "var(--color-ink)",
        borderColor: ring === "transparent" ? `color-mix(in srgb, ${color} 38%, transparent)` : ring,
        background: `color-mix(in srgb, ${isRisk ? "var(--color-danger)" : color} ${selected ? 26 : 14}%, var(--color-surface))`,
        boxShadow: selected ? `0 0 0 1px ${ring}` : "none",
      }}
    >
      {isRisk && <ShieldAlert size={11} className="shrink-0" style={{ color: "var(--color-danger)" }} />}
      {done && !isRisk && <Check size={10} className="shrink-0 text-ink-3" />}
      {sev && <span className="sr-only">{sev}</span>}
      <span className={cn("aac-truncate", done && "text-ink-2")}>{what}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
        {event.metrics?.durationMs != null && (
          <span className="aac-tnum font-mono text-[9px] text-ink-3">
            {formatDuration(event.metrics.durationMs)}
          </span>
        )}
        {exit != null && exit !== 0 && (
          <span
            className="rounded px-1 font-mono text-[9px] text-danger"
            style={{ background: "color-mix(in srgb, var(--color-danger) 16%, transparent)" }}
          >
            exit {exit}
          </span>
        )}
        {event.toolName && <span className="font-mono text-[9px] text-ink-3">{event.toolName}</span>}
      </span>
    </button>
  );
}

function SessionPicker({
  sessions,
  current,
  onPick,
}: {
  sessions: AgentSession[];
  current: AgentSession;
  onPick: (id: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={current.id}
        onChange={(e) => onPick(e.target.value)}
        className="h-8 max-w-[280px] cursor-pointer appearance-none truncate rounded-md border border-line bg-bg pl-2.5 pr-7 text-[13px] font-semibold text-ink focus:outline-none focus:ring-1 focus:ring-claude/40"
      >
        {sessions.map((s) => (
          <option key={s.id} value={s.id} className="bg-surface font-normal">
            {s.summary ?? s.id} · {AGENT_LABELS[s.agent]}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-3" />
    </div>
  );
}

function PlaybackBar({
  events,
  selectedId,
  onSelect,
  clock,
}: {
  events: NormalizedAgentEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  clock: string;
}) {
  const t = useT();
  const idx = Math.max(0, events.findIndex((e) => e.id === selectedId));
  const step = (d: number) => {
    const n = Math.min(events.length - 1, Math.max(0, idx + d));
    if (events[n]) onSelect(events[n].id);
  };
  return (
    <div className="flex items-center gap-3 border-t border-line bg-surface px-4 py-2">
      <div className="flex items-center gap-1">
        <CtrlButton onClick={() => step(-1)} label={t("Prev")}>‹</CtrlButton>
        <CtrlButton onClick={() => step(1)} label={t("Next")} accent>
          <Play size={13} />
        </CtrlButton>
      </div>
      <span className="aac-tnum w-20 font-mono text-[13px] text-ink">{clock}</span>
      {/* Scrub track */}
      <div className="relative h-2 flex-1 rounded-full bg-surface-2">
        <div
          className="absolute left-0 top-0 h-2 rounded-full"
          style={{
            width: events.length > 1 ? `${(idx / (events.length - 1)) * 100}%` : "0%",
            background: "var(--color-sel)",
          }}
        />
        {events.map((e, i) => (
          <button
            key={e.id}
            type="button"
            title={`${formatClock(e.timestamp)} · ${e.title}`}
            onClick={() => onSelect(e.id)}
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface"
            style={{
              left: events.length > 1 ? `${(i / (events.length - 1)) * 100}%` : "0%",
              background:
                e.type === "risk_finding"
                  ? "var(--color-danger)"
                  : e.id === selectedId
                  ? "var(--color-sel)"
                  : "var(--color-ink-3)",
            }}
          />
        ))}
      </div>
      <span className="text-[11px] text-ink-3">
        {idx + 1}/{events.length}
      </span>
    </div>
  );
}

function CtrlButton({
  children,
  onClick,
  label,
  accent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md border text-[14px] transition-colors",
        accent
          ? "border-sel/50 bg-sel/15 text-ink hover:bg-sel/25"
          : "border-line bg-bg text-ink-2 hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

// ---- Inspector ------------------------------------------------------------

const DEMO_DIFFS: Record<string, { added: number; deleted: number; lines: DiffLine[] }> = {
  "src/server/events.ts": {
    added: 132,
    deleted: 0,
    lines: [
      { type: "hunk", text: "@@ -0,0 +1,18 @@ session orchestration" },
      { type: "add", text: "export function ingest(raw: unknown): NormalizedAgentEvent {", newNo: 1 },
      { type: "add", text: "  const evt = normalize(raw);", newNo: 2 },
      { type: "add", text: "  const session = upsertSession(evt.sessionId, evt);", newNo: 3 },
      { type: "add", text: "  redact(evt); // strip secrets before persistence", newNo: 4 },
      { type: "add", text: "  db.insertEvent(evt);", newNo: 5 },
      { type: "add", text: "  return evt;", newNo: 6 },
      { type: "add", text: "}", newNo: 7 },
    ],
  },
  "src/app/dashboard.tsx": {
    added: 88,
    deleted: 24,
    lines: [
      { type: "hunk", text: "@@ -42,7 +42,9 @@ function Overview()" },
      { type: "ctx", text: "  const sessions = useSessions();", oldNo: 42, newNo: 42 },
      { type: "del", text: "  return <List items={sessions} />;", oldNo: 43 },
      { type: "add", text: "  const grouped = groupBySession(sessions);", newNo: 43 },
      { type: "add", text: "  return <SessionGroups groups={grouped} />;", newNo: 44 },
    ],
  },
};

function EventInspector({
  event,
  session,
}: {
  event: NormalizedAgentEvent;
  session: AgentSession;
}) {
  const t = useT();
  // Sample diffs are illustrative demo content only — never show them over live
  // data (we don't reconstruct real file diffs from hook events).
  const isDemo = useAppStore((s) => s.source) === "demo";
  const diff = isDemo && event.links?.files?.[0] ? DEMO_DIFFS[event.links.files[0]] : undefined;
  // WHAT: the full, untruncated redacted command (the stored title is cut at 90 chars).
  const desc = describeEvent(event);
  const fullCommand = eventCommand(event);
  return (
    <div className="flex flex-col">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Pill color={AGENT_COLOR_VAR[event.agent]}>{event.type.replace(/_/g, " ")}</Pill>
          {event.toolName && <Pill>{event.toolName}</Pill>}
        </div>
        <h3 className="mt-2 whitespace-pre-wrap break-words text-[14px] font-semibold leading-snug text-ink">
          {desc.what}
        </h3>
        {event.summary && <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{event.summary}</p>}
      </div>

      {/* WHAT — the full command, never truncated */}
      {fullCommand && (
        <div className="border-b border-line px-4 py-3">
          <div className="mb-1.5 text-[11px] font-medium text-ink-3">{t("Command (redacted, not executed)")}</div>
          <CommandBlock command={fullCommand} wrap />
        </div>
      )}

      <div className="border-b border-line px-4 py-2">
        <KeyValue label={t("Timestamp")} mono>{formatClock(event.timestamp)}</KeyValue>
        {/* WHERE */}
        {(event.repoPath ?? event.cwd) && (
          <KeyValue label={t("Repo")} mono>{event.repoPath ?? event.cwd}</KeyValue>
        )}
        {desc.file && (
          <KeyValue label={t("File")} mono>{desc.file}</KeyValue>
        )}
        {event.metrics?.durationMs != null && (
          <KeyValue label={t("Duration")} mono>{formatDuration(event.metrics.durationMs)}</KeyValue>
        )}
        {event.metrics?.exitCode != null && (
          <KeyValue label={t("Exit code")} mono>{event.metrics.exitCode}</KeyValue>
        )}
        {event.links?.commitSha && (
          <KeyValue label={t("Commit")} mono>{event.links.commitSha}</KeyValue>
        )}
        {event.links?.branch && (
          <KeyValue label={t("Branch")} mono>{event.links.branch}</KeyValue>
        )}
      </div>

      {diff && (
        <div className="border-b border-line px-4 py-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-ink-3">
            <Clock size={11} /> {t("Proposed change")}
          </div>
          <DiffViewer file={event.links!.files![0]} lines={diff.lines} added={diff.added} deleted={diff.deleted} />
        </div>
      )}

      {event.risk?.map((r) => (
        <div key={r.id} className="border-b border-line px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <RiskBadge severity={r.severity} />
            <CategoryChip category={r.category} />
          </div>
          <p className="text-[12px] leading-relaxed text-ink-2">{r.description}</p>
          {r.redactedEvidence && (
            <div className="mt-2">
              <CommandBlock label={t("Evidence")} command={r.redactedEvidence} danger />
            </div>
          )}
          <div className="mt-2 rounded-md border border-safe/30 bg-safe/5 px-2.5 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-safe">
              {t("Recommended action")}
            </div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{r.recommendedAction}</p>
          </div>
        </div>
      ))}

      <div className="px-4 py-3">
        <KeyValue label={t("Session")}>{session.summary}</KeyValue>
        <KeyValue label={t("Repo")} mono>{session.repoPath}</KeyValue>
      </div>
    </div>
  );
}
