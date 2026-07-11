import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookScript } from "../src/cli/hooks/script";
import { detectAgents } from "../src/cli/util/detect";
import { importSpool } from "../src/server/spool";
import { openDb, type AgentConsoleDb } from "../src/db/index";
import { createCollector } from "../src/server/collector";

describe("hookScript", () => {
  it("is self-contained, bakes in the agent, and never executes commands", () => {
    const src = hookScript("claude-code", "http://127.0.0.1:48321/events");
    expect(src).toContain('const AGENT = "claude-code"');
    expect(src).toContain("http://127.0.0.1:48321/events");
    expect(src).toContain("process.exit(0)"); // never blocks the agent
    expect(src).toContain("stripSecrets"); // redacts before spooling
    // It must not shell out / exec anything.
    expect(src).not.toMatch(/child_process|execSync|spawn|exec\(/);
  });
});

describe("spool import", () => {
  let db: AgentConsoleDb;
  let dir: string;

  beforeEach(() => {
    db = openDb(":memory:");
    dir = mkdtempSync(join(tmpdir(), "aac-spool-"));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("imports spooled events and archives the file", () => {
    const spool = join(dir, "spool.jsonl");
    writeFileSync(
      spool,
      [
        JSON.stringify({ agent: "claude-code", payload: { session_id: "s1", hook_event_name: "UserPromptSubmit", prompt: "hi" } }),
        JSON.stringify({ agent: "codex", payload: { session_id: "s2", hook_event_name: "PreToolUse", tool_name: "exec_command", tool_input: { cmd: "git push --force origin main" } } }),
      ].join("\n") + "\n"
    );
    const collector = createCollector(db);
    const n = importSpool(collector, dir);
    expect(n).toBe(2);
    expect(db.counts().sessions).toBe(2);
    expect(db.getRisk().some((r) => r.ruleId === "AAC-GIT-014")).toBe(true);
    // Spool file archived (not replayed twice).
    expect(existsSync(spool)).toBe(false);
    expect(importSpool(collector, dir)).toBe(0);
  });

  it("returns 0 when there is no spool file", () => {
    const collector = createCollector(db);
    expect(importSpool(collector, dir)).toBe(0);
  });
});

describe("agent detection", () => {
  it("detects a project-scoped Claude Code config and our installed hook", () => {
    const cwd = mkdtempSync(join(tmpdir(), "aac-proj-"));
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "settings.json"),
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "node ~/.aster-agent-audit/hooks/claude-code-hook.mjs" }] }] } })
    );
    const claude = detectAgents(cwd).find((a) => a.agent === "claude-code")!;
    expect(claude.present).toBe(true);
    expect(claude.hookInstalled).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("still detects a hook installed by a pre-rename version (legacy path)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "aac-proj-legacy-"));
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "settings.json"),
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "node ~/.aster-agent-console/hooks/claude-code-hook.mjs" }] }] } })
    );
    const claude = detectAgents(cwd).find((a) => a.agent === "claude-code")!;
    expect(claude.hookInstalled).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("cleanupCodexConfig — both fence generations", () => {
  it("removes a managed block written BEFORE the rename (legacy fences)", async () => {
    const { cleanupCodexConfig } = await import("../src/cli/hooks/installer");
    const body = [
      'model = "gpt-5-codex"',
      "# >>> aster-agent-console (managed) >>>",
      'notify = ["node", "/old/hook.mjs"]',
      "# <<< aster-agent-console (managed) <<<",
      "sandbox = true",
    ].join("\n");
    const out = cleanupCodexConfig(body);
    expect(out).not.toContain("managed");
    expect(out).toContain('model = "gpt-5-codex"');
    expect(out).toContain("sandbox = true");
  });

  it("removes a managed block with NEW fences too", async () => {
    const { cleanupCodexConfig } = await import("../src/cli/hooks/installer");
    const body = [
      "# >>> aster-agent-audit (managed) >>>",
      'notify = ["node", "/new/hook.mjs"]',
      "# <<< aster-agent-audit (managed) <<<",
      'model = "gpt-5-codex"',
    ].join("\n");
    const out = cleanupCodexConfig(body);
    expect(out).not.toContain("managed");
    expect(out).toContain('model = "gpt-5-codex"');
  });
});
