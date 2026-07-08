import {
  LayoutDashboard,
  History,
  ScrollText,
  FolderGit2,
  Radar,
  Bot,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  match: string;
};

export const NAV_ITEMS: NavItem[] = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard, match: "overview" },
  { to: "/session-replay", label: "Session Replay", icon: History, match: "session-replay" },
  { to: "/activity", label: "Activity Log", icon: ScrollText, match: "activity" },
  { to: "/repo-activity", label: "Repo Activity", icon: FolderGit2, match: "repo-activity" },
  { to: "/risk-radar", label: "Risk Radar", icon: Radar, match: "risk-radar" },
  { to: "/agents", label: "Agents", icon: Bot, match: "agents" },
  { to: "/insights", label: "Insights", icon: BarChart3, match: "insights" },
  { to: "/settings", label: "Settings", icon: Settings, match: "settings" },
];

export const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  overview: {
    title: "Overview",
    subtitle: "AI agent work at a glance — safety, audit, and outcomes",
  },
  "session-replay": {
    title: "Session Replay",
    subtitle: "Replay a session as an explainable sequence of events",
  },
  activity: {
    title: "Activity Log",
    subtitle: "When, where, and what every agent did — searchable",
  },
  "repo-activity": {
    title: "Repo Activity",
    subtitle: "Where agents touched the codebase, and whether it created value",
  },
  "risk-radar": {
    title: "Risk Radar",
    subtitle: "Agent safety as a daily checkable cockpit",
  },
  agents: { title: "Agents", subtitle: "Per-agent performance and integration status" },
  insights: { title: "Insights", subtitle: "Where your tokens, cost, and risk actually go" },
  settings: { title: "Settings", subtitle: "Integrations, storage, redaction, and diagnostics" },
};
