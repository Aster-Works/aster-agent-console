import { useDeferredValue, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ScrollText, Search } from "lucide-react";
import type { NormalizedAgentEvent } from "@core/types";
import { AGENT_LABELS } from "@core/types";
import { useDataset } from "../data/useDataset";
import { useAppStore } from "../app/store";
import { Panel, EmptyState, Pill } from "../components/ui";
import { AgentDot } from "../components/AgentBadge";
import { describeEvent, eventSearchText, isCompletion } from "../lib/describe";
import { AGENT_COLOR_VAR, formatDuration, formatNumber } from "../lib/format";
import { useT } from "../lib/i18n";
import { cn } from "../lib/cn";

// ponytail: render a capped page instead of virtualizing — search narrows it.
// Raise/virtualize only if a real workload needs more than this on screen.
const MAX_ROWS = 500;

/** When: date + time in the viewer's timezone. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function Activity() {
  const t = useT();
  const navigate = useNavigate();
  const dataset = useDataset();
  const search = useAppStore((s) => s.search);
  // Filtering + sorting tens of thousands of events is ~50ms; keep typing responsive.
  const deferred = useDeferredValue(search);
  const q = deferred.trim().toLowerCase();

  const { rows, total } = useMemo(() => {
    const all: NormalizedAgentEvent[] = Object.values(dataset.eventsBySession).flat();
    const matched = q ? all.filter((e) => eventSearchText(e).includes(q)) : all;
    matched.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    return { rows: matched.slice(0, MAX_ROWS), total: matched.length };
  }, [dataset.eventsBySession, q]);

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <Panel
        title={t("Agent Activity")}
        icon={ScrollText}
        subtitle={
          q
            ? t("{n} of {total} actions match “{q}”", { n: formatNumber(rows.length), total: formatNumber(total), q: deferred })
            : // "in range" — the date filter is above; this is not the whole DB.
              t("{total} actions in range · newest first", { total: formatNumber(total) })
        }
        className="min-h-0 flex-1"
        bodyClassName="flex min-h-0 flex-col"
        noBodyPadding
      >
        {total === 0 ? (
          <EmptyState icon={Search} title={q ? t("No actions match your search") : t("No actions recorded yet")}>
            {q ? t("Try a command, file name, tool, or repository.") : undefined}
          </EmptyState>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[860px] border-collapse text-[12px]">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-3">
                  <th className="px-3 py-2 text-left font-medium">{t("When")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("Agent")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("Where")}</th>
                  {/* absorbs the remaining width so the command has room to read */}
                  <th className="w-full px-3 py-2 text-left font-medium">{t("What")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("Type")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const d = describeEvent(e);
                  const exit = e.metrics?.exitCode;
                  const failed = exit != null && exit !== 0;
                  // The same command appears twice (intent, then completion).
                  // Nothing is hidden — the completion is just dimmed and ticked.
                  const done = isCompletion(e);
                  const dur = e.metrics?.durationMs;
                  return (
                    <tr
                      key={e.id}
                      onClick={() => navigate(`/session-replay/${e.sessionId}`)}
                      className="cursor-pointer border-b border-line/60 transition-colors hover:bg-surface-2"
                      title={d.what}
                    >
                      <td className="aac-tnum whitespace-nowrap px-3 py-1.5 align-top text-[11px] text-ink-3">
                        {formatWhen(e.timestamp)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 align-top">
                        <span className="flex items-center gap-1.5 text-[11px] text-ink-2">
                          <AgentDot agent={e.agent} />
                          {AGENT_LABELS[e.agent]}
                        </span>
                      </td>
                      <td className="max-w-[200px] px-3 py-1.5 align-top" title={e.repoPath ?? e.cwd}>
                        <div className="aac-truncate font-mono text-[11px] text-ink-2">{d.repo || "—"}</div>
                        {d.file && <div className="aac-truncate font-mono text-[10px] text-ink-3">{d.file}</div>}
                      </td>
                      <td className="max-w-0 px-3 py-1.5 align-top">
                        <div className="flex items-center gap-2">
                          {done && !failed && <Check size={11} className="shrink-0 text-ink-3" />}
                          <span
                            className={cn(
                              "aac-truncate font-mono text-[11px]",
                              failed ? "text-danger" : done ? "text-ink-2" : "text-ink"
                            )}
                          >
                            {d.what}
                          </span>
                          {dur != null && (
                            <span className="aac-tnum shrink-0 font-mono text-[10px] text-ink-3">
                              {formatDuration(dur)}
                            </span>
                          )}
                          {failed && (
                            <span className="shrink-0 rounded px-1 font-mono text-[9px] text-danger" style={{ background: "color-mix(in srgb, var(--color-danger) 16%, transparent)" }}>
                              exit {exit}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right align-top">
                        <Pill color={AGENT_COLOR_VAR[e.agent]}>
                          {e.toolName ?? e.type.replace(/_/g, " ")}
                        </Pill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {total > rows.length && (
              <div className="border-t border-line px-3 py-2 text-center text-[11px] text-ink-3">
                {t("Showing the newest {n} of {total} — narrow with search or the filters above.", {
                  n: formatNumber(rows.length),
                  total: formatNumber(total),
                })}
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
