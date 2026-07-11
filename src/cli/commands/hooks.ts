import pc from "picocolors";
import { installHooks, uninstallHooks, hooksStatus, type HookAction } from "../hooks/installer";
import { confirm } from "../util/prompt";
import { brand, check, heading, line, sym } from "../util/ui";

function reportAction(a: HookAction): void {
  const map: Record<HookAction["action"], boolean | "warn"> = {
    installed: true,
    removed: true,
    already: true,
    "would-install": "warn",
    skipped: "warn",
    "not-installed": "warn",
  };
  const verb: Record<HookAction["action"], string> = {
    installed: "hook installed",
    removed: "hook removed",
    already: "already installed",
    "would-install": "would install hook",
    skipped: "skipped",
    "not-installed": "not installed",
  };
  check(map[a.action], a.label, `${verb[a.action]} · ${a.detail}`);
  if (a.backup) line(`      ${sym.bullet} ${pc.dim(`backup → ${a.backup}`)}`);
}

export function hooksStatusCmd(): void {
  brand();
  heading("Hook status");
  for (const s of hooksStatus()) {
    if (!s.present) check("warn", s.label, "not detected");
    else if (s.installed) check(true, s.label, `installed · ${s.configPath}`);
    else check("warn", s.label, `detected · not installed · ${s.configPath ?? ""}`);
  }
  line("");
}

export function hooksUninstallCmd(): void {
  brand();
  heading("Removing hooks");
  const results = uninstallHooks();
  results.forEach(reportAction);
  line(`\n  ${sym.info} ${pc.dim("Original config was backed up before each change.")}`);
  line("");
}

/** Used by `aster-audit init --install-hooks` and `aster-audit hooks install`. */
export async function installHooksCmd(opts: { dryRun?: boolean; yes?: boolean } = {}): Promise<void> {
  const dryRun = opts.dryRun ?? false;
  brand();
  heading("Install agent hooks");

  // Preview first.
  const preview = installHooks(true);
  preview.forEach(reportAction);

  if (dryRun) {
    line(`\n  ${pc.dim("Dry run — no files were modified.")}`);
    line("");
    return;
  }

  const willChange = preview.filter((p) => p.action === "would-install");
  if (willChange.length === 0) {
    line(`\n  ${sym.ok} ${pc.dim("Nothing to do — hooks already installed or no agents detected.")}`);
    line("");
    return;
  }

  if (!opts.yes) {
    line("");
    const ok = await confirm(
      `${sym.warn} This will modify ${willChange.length} agent config file(s) (a backup is made first). Continue?`
    );
    if (!ok) {
      line(`  ${pc.dim("Cancelled. No changes made.")}`);
      line("");
      return;
    }
  }

  heading("Installing");
  const results = installHooks(false);
  results.forEach(reportAction);
  line(
    `\n  ${sym.ok} Done. Hooks POST to the local collector only. ${pc.dim("Run `aster-audit dashboard` to view activity.")}`
  );
  line("");
}
