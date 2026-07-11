/**
 * Hook installer (Phase 4). Safety guarantees:
 *  - The agent's existing config is ALWAYS backed up before any change.
 *  - Changes are additive and fenced/marked so they can be cleanly removed.
 *  - Nothing is written in dry-run mode.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  FENCE_END,
  FENCE_START,
  FENCE_MARKER,
  LEGACY_FENCE_END,
  LEGACY_FENCE_MARKER,
  LEGACY_FENCE_START,
} from "../../core/branding";
import { BACKUP_DIR, HOOKS_DIR, PORT, HOST } from "../util/paths";
import { detectAgents, type AgentDetection } from "../util/detect";
import { hookScript } from "./script";

const ENDPOINT = `http://${HOST}:${PORT}/events`;
const CLAUDE_EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart", "Stop"] as const;

/**
 * Is this settings.json hook command one of ours? Must recognize commands
 * written by ANY version — old installs point into `.aster-agent-console/`,
 * new ones into `.aster-agent-audit/` — or uninstall can no longer restore
 * a config written before the rename.
 */
function isManagedCommand(cmd: string | undefined): boolean {
  return Boolean(cmd && (cmd.includes(FENCE_MARKER) || cmd.includes(LEGACY_FENCE_MARKER)));
}

export type HookAction = {
  agent: string;
  label: string;
  action: "installed" | "already" | "skipped" | "would-install" | "removed" | "not-installed";
  detail: string;
  backup?: string;
};

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backup(file: string): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = join(BACKUP_DIR, `${basename(file)}.${stamp()}.bak`);
  copyFileSync(file, dest);
  return dest;
}

function writeHookFile(agent: string): string {
  mkdirSync(HOOKS_DIR, { recursive: true });
  const path = join(HOOKS_DIR, `${agent}-hook.mjs`);
  writeFileSync(path, hookScript(agent, ENDPOINT), { mode: 0o755 });
  return path;
}

function quote(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p;
}

// ---- Claude Code (settings.json hooks) ------------------------------------

function installClaude(det: AgentDetection, dryRun: boolean): HookAction {
  const target = det.configPaths.find((p) => p.exists) ?? det.configPaths[0];
  const file = target.path;

  if (det.hookInstalled) {
    return { agent: "claude-code", label: "Claude Code", action: "already", detail: file };
  }
  if (dryRun) {
    return { agent: "claude-code", label: "Claude Code", action: "would-install", detail: file };
  }

  let settings: Record<string, unknown> = {};
  let backupPath: string | undefined;
  if (existsSync(file)) {
    backupPath = backup(file);
    try {
      settings = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      settings = {};
    }
  } else {
    mkdirSync(join(file, ".."), { recursive: true });
  }

  const hookPath = writeHookFile("claude-code");
  const command = `node ${quote(hookPath)}`;
  const hooks = (settings.hooks ??= {}) as Record<string, unknown[]>;

  for (const event of CLAUDE_EVENTS) {
    const arr = (hooks[event] ??= []) as Array<{ matcher?: string; hooks?: Array<{ type: string; command: string }> }>;
    const present = arr.some((g) => g.hooks?.some((h) => isManagedCommand(h.command)));
    if (!present) {
      const isTool = event === "PreToolUse" || event === "PostToolUse";
      arr.push({ ...(isTool ? { matcher: "*" } : {}), hooks: [{ type: "command", command }] });
    }
  }

  writeFileSync(file, JSON.stringify(settings, null, 2));
  return { agent: "claude-code", label: "Claude Code", action: "installed", detail: file, backup: backupPath };
}

// ---- Codex (automatic: reads ~/.codex/sessions, no config change) ----------

const CODEX_AUTO_DETAIL = "automatic — reads ~/.codex/sessions (no config change)";

/**
 * Remove a legacy managed notify block and reconcile any `notify` line an older
 * version commented out. Codex has a single `notify` slot: earlier versions
 * hijacked it, which could shadow the user's own consumer (e.g. Codex Computer
 * Use). We now read the rollout logs instead, so this repairs old installs.
 *  - drop the managed fence block entirely
 *  - if an active `notify` already exists, the `# [aster-agent] disabled:` copy
 *    is a duplicate → remove it; otherwise restore (uncomment) it.
 */
export function cleanupCodexConfig(body: string): string {
  let out = body;
  // Both fence generations: blocks written before AND after the product rename.
  for (const [start, end] of [
    [LEGACY_FENCE_START, LEGACY_FENCE_END],
    [FENCE_START, FENCE_END],
  ]) {
    const fence = new RegExp(`\\n*${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}\\n?`, "g");
    out = out.replace(fence, "\n");
  }
  const withoutDisabled = out.replace(/^# \[aster-agent\] disabled: .*$/gm, "");
  const hasActiveNotify = /^\s*notify\s*=/m.test(withoutDisabled);
  if (hasActiveNotify) {
    out = out.replace(/^# \[aster-agent\] disabled: .*\n?/gm, "");
  } else {
    out = out.replace(/^# \[aster-agent\] disabled: (.*)$/gm, "$1");
  }
  return out.replace(/\n{3,}/g, "\n\n");
}

function installCodex(det: AgentDetection, dryRun: boolean): HookAction {
  const target = det.configPaths.find((p) => p.exists && p.path.endsWith("config.toml")) ?? det.configPaths[0];
  const file = target.path;

  // Codex activity is collected by reading its rollout logs — nothing to wire
  // in. If an older version left a managed notify block, repair it.
  if (!existsSync(file)) {
    return { agent: "codex", label: "Codex", action: "already", detail: CODEX_AUTO_DETAIL };
  }
  const body = readFileSync(file, "utf8");
  const cleaned = cleanupCodexConfig(body);
  if (cleaned === body) {
    return { agent: "codex", label: "Codex", action: "already", detail: CODEX_AUTO_DETAIL };
  }
  if (dryRun) {
    return { agent: "codex", label: "Codex", action: "would-install", detail: `repair legacy notify block in ${file}` };
  }
  const backupPath = backup(file);
  writeFileSync(file, cleaned);
  return {
    agent: "codex",
    label: "Codex",
    action: "installed",
    detail: `repaired legacy notify block · ${CODEX_AUTO_DETAIL}`,
    backup: backupPath,
  };
}

// ---- Public API -----------------------------------------------------------

export function installHooks(dryRun = false, cwd = process.cwd()): HookAction[] {
  const agents = detectAgents(cwd);
  const out: HookAction[] = [];
  for (const det of agents) {
    if (!det.present) {
      out.push({ agent: det.agent, label: det.label, action: "skipped", detail: "not detected" });
      continue;
    }
    out.push(det.agent === "claude-code" ? installClaude(det, dryRun) : installCodex(det, dryRun));
  }
  return out;
}

export function uninstallHooks(cwd = process.cwd()): HookAction[] {
  const agents = detectAgents(cwd);
  const out: HookAction[] = [];
  for (const det of agents) {
    if (det.agent === "codex") {
      // Codex is read-only auto-collection; "uninstall" only strips a legacy
      // managed notify block if one is still present.
      const target = det.configPaths.find((p) => p.exists && p.path.endsWith("config.toml"));
      if (!target) {
        out.push({ agent: det.agent, label: det.label, action: "not-installed", detail: CODEX_AUTO_DETAIL });
        continue;
      }
      const body = readFileSync(target.path, "utf8");
      const cleaned = cleanupCodexConfig(body);
      if (cleaned === body) {
        out.push({ agent: det.agent, label: det.label, action: "not-installed", detail: "no managed block" });
        continue;
      }
      const backupPath = backup(target.path);
      writeFileSync(target.path, cleaned);
      out.push({ agent: det.agent, label: det.label, action: "removed", detail: target.path, backup: backupPath });
      continue;
    }

    const target = det.configPaths.find((p) => p.exists);
    if (!target || !det.hookInstalled) {
      out.push({ agent: det.agent, label: det.label, action: "not-installed", detail: target?.path ?? "—" });
      continue;
    }
    const file = target.path;
    const backupPath = backup(file);
    try {
      const settings = JSON.parse(readFileSync(file, "utf8")) as { hooks?: Record<string, unknown[]> };
      const hooks = settings.hooks ?? {};
      for (const event of Object.keys(hooks)) {
        hooks[event] = (hooks[event] as Array<{ hooks?: Array<{ command?: string }> }>).filter(
          (g) => !g.hooks?.some((h) => isManagedCommand(h.command))
        );
        if ((hooks[event] as unknown[]).length === 0) delete hooks[event];
      }
      writeFileSync(file, JSON.stringify(settings, null, 2));
    } catch {
      /* leave backup in place */
    }
    out.push({ agent: det.agent, label: det.label, action: "removed", detail: file, backup: backupPath });
  }
  return out;
}

export function hooksStatus(cwd = process.cwd()): {
  agent: string;
  label: string;
  present: boolean;
  installed: boolean;
  mechanism: "hook" | "auto";
  configPath?: string;
}[] {
  return detectAgents(cwd).map((d) => ({
    agent: d.agent,
    label: d.label,
    present: d.present,
    installed: d.hookInstalled,
    mechanism: d.mechanism,
    configPath: d.configPaths.find((p) => p.exists)?.path,
  }));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
