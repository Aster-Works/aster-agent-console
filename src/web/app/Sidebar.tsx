import { NavLink } from "react-router-dom";
import { Hexagon, ShieldCheck } from "lucide-react";
import { useAppStore } from "./store";
import { NAV_ITEMS } from "./nav";
import { cn } from "../lib/cn";
import { AGENT_LABELS } from "@core/types";
import { AGENT_COLOR_VAR, formatUsd, formatTokens } from "../lib/format";
import { Sparkline } from "../components/Sparkline";
import { StatusDot } from "../components/ui";
import { useT } from "../lib/i18n";

// Stamped by Vite's define from package.json; falls back under bare test tools.
declare const __AAC_VERSION__: string;
const APP_VERSION = typeof __AAC_VERSION__ === "string" ? __AAC_VERSION__ : "dev";

export function Sidebar() {
  const dataset = useAppStore((s) => s.dataset);
  const status = dataset.status;
  const t = useT();

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-line bg-surface">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-md"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in srgb, var(--color-claude) 30%, transparent), color-mix(in srgb, var(--color-codex) 30%, transparent))",
            border: "1px solid var(--color-line)",
          }}
        >
          <Hexagon size={15} className="text-ink" strokeWidth={2.25} />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="aac-truncate text-[13px] font-semibold tracking-tight text-ink">
            Aster Agent Audit
          </div>
          <div className="text-[10px] text-ink-3">{`v${APP_VERSION} · local-first`}</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center gap-2.5 rounded-md border-l-2 px-2.5 py-2 text-[13px] font-medium transition-colors",
                    isActive
                      ? "border-l-claude bg-surface-2 text-ink"
                      : "border-l-transparent text-ink-2 hover:bg-surface-2/60 hover:text-ink"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      size={16}
                      strokeWidth={2}
                      className={cn(isActive ? "text-claude" : "text-ink-3 group-hover:text-ink-2")}
                    />
                    {t(item.label)}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Collector status + agents */}
      <div className="border-t border-line px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
            <StatusDot
              color={status.online ? "var(--color-safe)" : "var(--color-warn)"}
              pulse={status.online}
            />
            {t("Collector")}
          </div>
          <span className="text-[10px] uppercase tracking-wide text-ink-3">
            {status.mode === "demo" ? t("Demo data") : status.online ? t("Online") : t("Offline")}
          </span>
        </div>
        <div className="space-y-1.5">
          {dataset.overview.perAgent.map((a) => (
            <div key={a.agent} className="aac-card-2 px-2 py-1.5">
              <div className="flex items-center justify-between">
                <span
                  className="text-[11px] font-medium"
                  style={{ color: AGENT_COLOR_VAR[a.agent] }}
                >
                  {AGENT_LABELS[a.agent]}
                </span>
                <span className="aac-tnum text-[10px] text-ink-3">
                  {formatTokens(a.tokens)} · {formatUsd(a.costUsd)}
                </span>
              </div>
              <Sparkline data={a.spark} color={AGENT_COLOR_VAR[a.agent]} height={20} />
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-[10px] leading-tight text-ink-3">
          <ShieldCheck size={12} className="shrink-0 text-safe" />
          {t("No account. No cloud. History stays on your machine.")}
        </div>
      </div>
    </aside>
  );
}
