/**
 * Detect possible Claude Code / Codex configuration locations. Read-only: this
 * never modifies any file (used by `init --dry-run` and `doctor`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { FENCE_MARKER, LEGACY_FENCE_MARKER } from "../../core/branding";

export type ConfigPath = {
  path: string;
  exists: boolean;
  scope: "user" | "project";
};

export type AgentDetection = {
  agent: "claude-code" | "codex";
  label: string;
  present: boolean;
  configPaths: ConfigPath[];
  /**
   * How this agent's activity is collected:
   *  - "hook": a command hook wired into the agent's config (Claude Code)
   *  - "auto": we read the agent's own session logs, no config change (Codex)
   */
  mechanism: "hook" | "auto";
  /**
   * Collection is active. For "hook" agents this means the hook is wired in;
   * for "auto" agents it means the session-log source exists to read.
   */
  hookInstalled: boolean;
};

function entry(path: string, scope: "user" | "project"): ConfigPath {
  return { path, exists: existsSync(path), scope };
}

function fileMentions(path: string, needle: string): boolean {
  try {
    return existsSync(path) && readFileSync(path, "utf8").includes(needle);
  } catch {
    return false;
  }
}

export function detectAgents(cwd: string = process.cwd()): AgentDetection[] {
  const home = homedir();

  const claudePaths: ConfigPath[] = [
    entry(join(home, ".claude", "settings.json"), "user"),
    entry(join(cwd, ".claude", "settings.json"), "project"),
    entry(join(cwd, ".claude", "settings.local.json"), "project"),
  ];
  const codexPaths: ConfigPath[] = [
    entry(join(home, ".codex", "config.toml"), "user"),
    entry(join(home, ".codex", "hooks.toml"), "user"),
    entry(join(cwd, ".codex", "config.toml"), "project"),
  ];

  // Claude's hook lives in settings.json; Codex has no hook — we read its
  // rollout logs directly, so "collecting" just means those logs exist.
  // Match both dir generations explicitly (pre- and post-rename installs).
  const claudeHook = claudePaths.some(
    (p) => fileMentions(p.path, FENCE_MARKER) || fileMentions(p.path, LEGACY_FENCE_MARKER)
  );
  const codexSessions = join(home, ".codex", "sessions");

  return [
    {
      agent: "claude-code",
      label: "Claude Code",
      present: claudePaths.some((p) => p.exists) || existsSync(join(home, ".claude")),
      configPaths: claudePaths,
      mechanism: "hook",
      hookInstalled: claudeHook,
    },
    {
      agent: "codex",
      label: "Codex",
      present: codexPaths.some((p) => p.exists) || existsSync(join(home, ".codex")),
      configPaths: codexPaths,
      mechanism: "auto",
      hookInstalled: existsSync(codexSessions),
    },
  ];
}
