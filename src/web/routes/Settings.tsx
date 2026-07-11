import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plug,
  HardDrive,
  EyeOff,
  ShieldAlert,
  Download,
  Stethoscope,
  CheckCircle2,
  CircleAlert,
  Lock,
  Timer,
  Coins,
  Save,
} from "lucide-react";
import { useAppStore } from "../app/store";
import { useT } from "../lib/i18n";
import { Panel, KeyValue, Pill, EmptyState } from "../components/ui";
import { AgentBadge } from "../components/AgentBadge";
import { CommandBlock } from "../components/CommandBlock";

type RateTuple = [number, number, number, number];
type SettingsData = {
  status: { mode: string; port: number; dbPath: string };
  dbPath: string;
  counts: { sessions: number; events: number; risk: number; fileChanges: number };
  retentionDays: number;
  pricing: Record<string, RateTuple>;
  pricingFamilies: string[];
  agents: { agent: "claude-code" | "codex"; label: string; present: boolean; installed: boolean; mechanism: "hook" | "auto"; configPath?: string }[];
  diagnostics: { label: string; ok: boolean; detail: string }[];
  rules: { ruleId: string; category: string; severity: string; title: string }[];
};

function useSettings(live: boolean) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!live) {
      setData(null);
      return;
    }
    let ok = true;
    fetch("/api/settings", { headers: { accept: "application/json" } })
      .then((r) => r.json())
      .then((d) => ok && setData(d as SettingsData))
      .catch((e) => ok && setError(String(e)));
    return () => {
      ok = false;
    };
  }, [live]);

  const save = useCallback(async (patch: { retentionDays?: number; pricing?: Record<string, RateTuple> }) => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      setData((await r.json()) as SettingsData);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  return { data, error, saving, save };
}

export function Settings() {
  const source = useAppStore((s) => s.source);
  const status = useAppStore((s) => s.dataset.status);
  const live = source === "live";
  const { data, saving, save } = useSettings(live);
  const t = useT();

  return (
    <div className="space-y-4 p-4">
      {/* Local-first banner */}
      <div className="aac-card flex items-center gap-3 px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-md border border-safe/30 bg-safe/10">
          <Lock size={16} className="text-safe" />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink">
            {t("No account. No cloud. Your agent history stays on your machine.")}
          </div>
          <div className="text-[11px] text-ink-3">
            {t("Data is stored locally in SQLite. Secrets are redacted before storage. Nothing is uploaded.")}
          </div>
        </div>
        {live ? (
          <Pill color="var(--color-safe)" className="ml-auto shrink-0">
            <CheckCircle2 size={11} /> {t("Live collector")}
          </Pill>
        ) : (
          <Pill color="var(--color-warn)" className="ml-auto shrink-0">
            <CircleAlert size={11} /> {t("Demo mode")}
          </Pill>
        )}
      </div>

      {!live && (
        <div className="aac-card px-4 py-3 text-[12px] text-ink-2">
          {t("You’re viewing demo data. Start the collector to see and edit real settings:")}
          <div className="mt-2 max-w-sm">
            <CommandBlock command="aster-audit dashboard" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Agent integrations — real status */}
        <Panel title={t("Agent Integrations")} icon={Plug} subtitle={t("How each agent’s activity is collected")}>
          <div className="space-y-2">
            {(data?.agents ?? fallbackAgents()).map((a) => (
              <div key={a.agent} className="rounded-md border border-line bg-surface-2 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <AgentBadge agent={a.agent} size="md" />
                  <AgentStatusPill a={a} live={live} />
                </div>
                {a.configPath && (
                  <div className="mt-1 truncate font-mono text-[10px] text-ink-3" title={a.configPath}>
                    {a.configPath}
                  </div>
                )}
              </div>
            ))}
            <div className="rounded-md border border-line bg-bg px-3 py-2.5">
              <div className="mb-1.5 text-[11px] text-ink-3">
                {t("Claude Code uses a local hook; Codex is read automatically from its session logs — no config change.")}
              </div>
              <CommandBlock command="aster-audit init" />
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
                {t("Existing config is backed up first. The hook only POSTs to")}{" "}
                <span className="font-mono">127.0.0.1:{data?.status.port ?? status.port}</span> {t("and never blocks your workflow.")}
              </p>
            </div>
          </div>
        </Panel>

        {/* Data retention — editable */}
        <Panel title={t("Data Retention")} icon={Timer} subtitle={t("How long history is kept before pruning")}>
          {live && data ? (
            <RetentionEditor value={data.retentionDays} saving={saving} onSave={(d) => save({ retentionDays: d })} />
          ) : (
            <EmptyState icon={Timer} title={t("Start the collector to edit retention")} />
          )}
        </Panel>

        {/* Cost model — editable pricing */}
        <Panel title={t("Cost Model")} icon={Coins} subtitle={t("Estimate rates — USD per 1M tokens")} className="xl:col-span-2">
          {live && data ? (
            <PricingEditor
              families={data.pricingFamilies}
              pricing={data.pricing}
              saving={saving}
              onSave={(p) => save({ pricing: p })}
            />
          ) : (
            <EmptyState icon={Coins} title={t("Start the collector to edit rates")} />
          )}
        </Panel>

        {/* Local storage */}
        <Panel title={t("Local Storage")} icon={HardDrive} subtitle={t("Where your data lives")}>
          <div className="aac-inset rounded-md px-3 py-1.5">
            <KeyValue label={t("Database")} mono>{data?.dbPath ?? status.dbPath}</KeyValue>
            <KeyValue label={t("Config dir")} mono>~/.aster-agent-console/</KeyValue>
            <KeyValue label={t("Spool")} mono>~/.aster-agent-console/spool/</KeyValue>
            <KeyValue label={t("Backups")} mono>~/.aster-agent-console/backups/</KeyValue>
            {data && (
              <KeyValue label={t("Stored")}>
                {t("{sessions} sessions · {events} events · {files} file changes", {
                  sessions: data.counts.sessions,
                  events: data.counts.events,
                  files: data.counts.fileChanges,
                })}
              </KeyValue>
            )}
            <KeyValue label={t("Mode")}>
              <span className="capitalize">{data?.status.mode ?? status.mode}</span>
            </KeyValue>
          </div>
        </Panel>

        {/* Export — working in live mode */}
        <Panel title={t("Export")} icon={Download} subtitle={t("Manual & local — nothing leaves unless you click")}>
          <ExportButtons live={live} />
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            {t("Export is on-demand and downloads to your machine. Cloud sync is not part of this tool.")}
          </p>
        </Panel>

        {/* Redaction policy */}
        <Panel title={t("Redaction Policy")} icon={EyeOff} subtitle={t("Always on — secrets are stripped before storage")}>
          <div className="grid grid-cols-2 gap-1.5">
            {["API keys (sk-…)", "GitHub tokens (ghp_…)", "Supabase / JWT", "Private keys", ".env values", "Bearer tokens", "AWS keys", "URL credentials"].map((k) => (
              <span key={k} className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[11px] text-ink-2">
                <CheckCircle2 size={12} className="text-safe" /> {t(k)}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            {t("Raw secret values are never persisted — only a redacted replacement, a fingerprint, and finding metadata.")}
          </p>
        </Panel>

        {/* Risk policy — real active rules */}
        <Panel
          title={t("Risk Policy")}
          icon={ShieldAlert}
          subtitle={data ? t("{n} active detection rules", { n: data.rules.length }) : t("Active detection rules")}
          className="xl:col-span-2"
        >
          {data ? (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {data.rules.map((r) => (
                <Rule key={r.ruleId} id={r.ruleId} text={r.title} severity={r.severity} />
              ))}
            </div>
          ) : (
            <EmptyState icon={ShieldAlert} title={t("Start the collector to list active rules")} />
          )}
        </Panel>

        {/* Diagnostics — real */}
        <Panel title={t("Diagnostics")} icon={Stethoscope} subtitle={t("Live environment checks")} className="xl:col-span-2">
          {data ? (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {data.diagnostics.map((d) => (
                <Diag key={d.label} ok={d.ok} label={d.label} detail={d.detail} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <EmptyState icon={Stethoscope} title={t("Start the collector for live diagnostics")} />
              <CommandBlock command="aster-audit doctor" />
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function fallbackAgents(): SettingsData["agents"] {
  return [
    { agent: "claude-code", label: "Claude Code", present: false, installed: false, mechanism: "hook" },
    { agent: "codex", label: "Codex", present: false, installed: false, mechanism: "auto" },
  ];
}

function AgentStatusPill({ a, live }: { a: SettingsData["agents"][number]; live: boolean }) {
  const t = useT();
  if (!live) return <span className="text-[11px] text-ink-3">{t("demo")}</span>;
  if (a.installed) {
    return (
      <Pill color="var(--color-safe)">
        <CheckCircle2 size={11} /> {a.mechanism === "auto" ? t("Auto — session logs") : t("Collecting (hook)")}
      </Pill>
    );
  }
  return (
    <Pill color="var(--color-warn)">
      <CircleAlert size={11} /> {a.mechanism === "auto" ? t("No Codex logs yet") : t("Hook not installed")}
    </Pill>
  );
}

function RetentionEditor({ value, saving, onSave }: { value: number; saving: boolean; onSave: (d: number) => void }) {
  const t = useT();
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const parsed = Math.max(0, Math.round(Number(v) || 0));
  const dirty = parsed !== value;
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-3">{t("Keep history for")}</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              max={3650}
              value={v}
              onChange={(e) => setV(e.target.value)}
              className="aac-tnum h-8 w-24 rounded-md border border-line bg-bg px-2 text-[13px] text-ink focus:border-claude/40 focus:outline-none focus:ring-1 focus:ring-claude/40"
            />
            <span className="text-[12px] text-ink-2">{t("days")}</span>
          </div>
        </label>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => onSave(parsed)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-claude/40 bg-claude/10 px-3 text-[12px] font-medium text-claude disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save size={13} /> {saving ? t("Saving…") : t("Save")}
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-3">
        {t("Older sessions, events and findings are pruned on start and every 12h. Set to")} <span className="font-mono">0</span> {t("to keep everything.")}
      </p>
    </div>
  );
}

const RATE_LABELS = ["input", "output", "cache read", "cache write"] as const;

function PricingEditor({
  families,
  pricing,
  saving,
  onSave,
}: {
  families: string[];
  pricing: Record<string, RateTuple>;
  saving: boolean;
  onSave: (p: Record<string, RateTuple>) => void;
}) {
  const t = useT();
  const [table, setTable] = useState<Record<string, RateTuple>>(pricing);
  useEffect(() => setTable(pricing), [pricing]);
  const dirty = useMemo(() => JSON.stringify(table) !== JSON.stringify(pricing), [table, pricing]);

  const setCell = (fam: string, i: number, val: string) => {
    const n = Number(val);
    setTable((prev) => {
      const row = [...(prev[fam] ?? [0, 0, 0, 0])] as RateTuple;
      // Empty → 0 (an explicit, visible choice); a negative or non-numeric entry
      // is rejected (keep the prior value) rather than silently becoming a 0 rate.
      row[i] = val.trim() === "" ? 0 : Number.isFinite(n) && n >= 0 ? n : row[i];
      return { ...prev, [fam]: row };
    });
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[12px]">
          <thead>
            <tr className="text-[11px] text-ink-3">
              <th className="px-2 py-1 text-left font-medium">{t("Model family")}</th>
              {RATE_LABELS.map((l) => (
                <th key={l} className="px-2 py-1 text-right font-medium">{t(l)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {families.map((fam) => (
              <tr key={fam} className="border-t border-line">
                <td className="px-2 py-1.5 font-mono text-ink-2">{fam}</td>
                {[0, 1, 2, 3].map((i) => (
                  <td key={i} className="px-2 py-1.5 text-right">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={table[fam]?.[i] ?? 0}
                      onChange={(e) => setCell(fam, i, e.target.value)}
                      className="aac-tnum h-7 w-20 rounded-md border border-line bg-bg px-1.5 text-right text-[12px] text-ink focus:border-claude/40 focus:outline-none focus:ring-1 focus:ring-claude/40"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => onSave(table)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-claude/40 bg-claude/10 px-3 text-[12px] font-medium text-claude disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save size={13} /> {saving ? t("Saving…") : t("Save rates")}
        </button>
        <span className="text-[11px] text-ink-3">{t("USD per 1M tokens. Cost is an estimate; tokens are exact.")}</span>
      </div>
    </div>
  );
}

function ExportButtons({ live }: { live: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);

  const download = async (kind: "json" | "csv") => {
    setBusy(kind);
    try {
      if (kind === "json") {
        const d = await (await fetch("/api/dataset")).json();
        triggerDownload(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }), "aster-audit-report.json");
      } else {
        const rows = (await (await fetch("/api/risk-findings")).json()) as Record<string, unknown>[];
        triggerDownload(new Blob([toCsv(rows)], { type: "text/csv" }), "aster-audit-findings.csv");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <ExportButton disabled={!live} busy={busy === "json"} onClick={() => download("json")} label={t("Export work report (JSON)")} />
      <ExportButton disabled={!live} busy={busy === "csv"} onClick={() => download("csv")} label={t("Export findings (CSV)")} />
    </div>
  );
}

function ExportButton({ label, disabled, busy, onClick }: { label: string; disabled: boolean; busy: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={disabled ? t("Available in live mode") : undefined}
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink-2 enabled:hover:border-claude/40 disabled:cursor-not-allowed disabled:text-ink-3"
    >
      <Download size={13} /> {busy ? t("Preparing…") : label}
    </button>
  );
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "ruleId,severity,category,title\n";
  const cols = ["ruleId", "severity", "category", "title", "agent", "sessionId", "timestamp"];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

const SEV_COLOR: Record<string, string> = {
  critical: "var(--color-danger)",
  high: "var(--color-danger)",
  medium: "var(--color-warn)",
  low: "var(--color-ink-3)",
  info: "var(--color-ink-3)",
};

function Rule({ id, text, severity }: { id: string; text: string; severity: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px]">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEV_COLOR[severity] ?? "var(--color-ink-3)" }} />
      <span className="aac-truncate flex-1 text-ink-2">{text}</span>
      <span className="shrink-0 font-mono text-[10px] text-ink-3">{id}</span>
    </div>
  );
}

function Diag({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px]">
      {ok ? (
        <CheckCircle2 size={13} className="shrink-0 text-safe" />
      ) : (
        <CircleAlert size={13} className="shrink-0 text-warn" />
      )}
      <span className="flex-1 text-ink-2">{label}</span>
      <span className="aac-truncate font-mono text-[10px] text-ink-3">{detail}</span>
    </div>
  );
}
