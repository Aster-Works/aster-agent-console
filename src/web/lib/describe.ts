/**
 * The single answer to "when / where / what did the agent do?".
 *
 * The stored `title` is not enough: a completed tool call is titled
 * "Bash complete" / "exec_command complete" — the actual command lives in the
 * (redacted) input. Every surface that shows or searches an event derives its
 * description here, so the timeline, the activity log, and search always agree.
 */
import type { NormalizedAgentEvent } from "@core/types";

export type EventDesc = {
  /** WHAT: the redacted command / touched file / prompt — never "X complete". */
  what: string;
  /** WHERE: the repository (or cwd) the agent was working in. */
  repo: string;
  /** WHERE, precisely: the file it touched, relative to the repo when possible. */
  file?: string;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function pick(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

export function baseName(p?: string): string {
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** The FULL redacted command, untruncated (the stored title is cut at 90 chars). */
export function eventCommand(e: NormalizedAgentEvent): string | undefined {
  return pick(asRecord(e.input?.value), ["command", "cmd", "script"]) || undefined;
}

/**
 * How a non-shell tool names its own action: the URL a fetch hit, the query a
 * search ran, the expression an eval evaluated. Without these, ~13% of real
 * events fall through to the title and read "WebFetch complete".
 */
const WHAT_KEYS = ["url", "query", "pattern", "expression", "prompt", "description", "text", "selector"];

/** The first line that says something — not a blank line, not a shebang/comment. */
function firstMeaningfulLine(s: string): string {
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => !l.startsWith("#")) ?? lines[0] ?? "";
}

export function describeEvent(e: NormalizedAgentEvent): EventDesc {
  const input = asRecord(e.input?.value);
  const repoPath = e.repoPath ?? e.cwd;
  const repo = baseName(repoPath);

  let file = e.links?.files?.[0] ?? pick(input, ["file_path", "path", "filePath", "target"]) ?? "";
  if (file && repoPath && file.startsWith(repoPath + "/")) file = file.slice(repoPath.length + 1);

  const cmd = eventCommand(e) ?? "";
  const what =
    firstMeaningfulLine(cmd) ||
    file ||
    (e.type === "user_prompt" ? e.summary || e.title : "") ||
    pick(input, WHAT_KEYS) ||
    e.title;

  return { what, repo, file: file || undefined };
}

// A tool call is recorded twice: the intent (pre_tool_use) and the completion.
// Both are kept — an audit log shouldn't hide events — but the completion is
// rendered as such so the same command doesn't read as two separate actions.
const COMPLETION = new Set(["post_tool_use", "test_result", "git_event"]);
export function isCompletion(e: NormalizedAgentEvent): boolean {
  return COMPLETION.has(e.type);
}

// Rebuilt on every keystroke across every event otherwise. Events are stable
// objects for the life of a dataset, so a WeakMap keyed on them is free.
const HAYSTACK = new WeakMap<NormalizedAgentEvent, string>();

/** Lowercased haystack for text search across when/where/what. */
export function eventSearchText(e: NormalizedAgentEvent): string {
  const cached = HAYSTACK.get(e);
  if (cached !== undefined) return cached;
  const d = describeEvent(e);
  // The FULL command, not just `what`: a `git commit` on line 5 of a heredoc is
  // still something the agent did, and an audit log that cannot find it is lying.
  const hay = `${d.what} ${eventCommand(e) ?? ""} ${d.repo} ${d.file ?? ""} ${e.toolName ?? ""} ${e.type} ${e.title}`.toLowerCase();
  HAYSTACK.set(e, hay);
  return hay;
}
