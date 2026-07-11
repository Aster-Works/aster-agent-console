/**
 * `aster-audit scan [dir]` — scan local MCP configuration for security risks
 * (Phase 6). Read-only: discovers and inspects config files as text, never
 * executes anything. Exits non-zero when findings meet the policy's failOn
 * threshold, so it works as a CI / pre-flight gate.
 */
import pc from "picocolors";
import { scanMcpEnvironment } from "../../server/mcp-scan";
import { hasBlockingFindings } from "../../core/policy";
import { CONFIG_DIR } from "../util/paths";
import { brand, heading, line, sym } from "../util/ui";
import type { RiskSeverity } from "../../core/types";

const SEV_COLOR: Record<RiskSeverity, (s: string) => string> = {
  critical: (s) => pc.red(pc.bold(s)),
  high: (s) => pc.red(s),
  medium: (s) => pc.yellow(s),
  low: (s) => pc.cyan(s),
  info: (s) => pc.dim(s),
};

const GRADE_COLOR: Record<string, (s: string) => string> = {
  A: pc.green,
  B: pc.green,
  C: pc.yellow,
  D: pc.red,
  F: (s) => pc.red(pc.bold(s)),
};

export async function scanCmd(dir?: string): Promise<void> {
  const cwd = dir ?? process.cwd();
  const scan = scanMcpEnvironment({ cwd, configDir: CONFIG_DIR });

  brand();
  heading("MCP configuration scan");
  if (scan.summary.configFiles.length === 0) {
    line(`  ${sym.info} No MCP config files found under ${pc.dim(cwd)} or your home directory.`);
    line("");
    return;
  }
  line(`  ${sym.bullet} Scanned ${scan.summary.configFiles.join(", ")}`);
  line(
    `  ${sym.bullet} ${scan.summary.serverCount} server(s) · ${scan.findings.length} finding(s) · posture ` +
      `${(GRADE_COLOR[scan.summary.grade] ?? pc.white)(`${scan.summary.grade} (${scan.summary.score}/100)`)}`
  );

  heading("Servers");
  for (const s of scan.servers) {
    const mark = s.risk === "info" ? sym.ok : s.risk === "medium" || s.risk === "low" ? sym.warn : sym.fail;
    line(
      `  ${mark} ${pc.bold(s.name)} ${pc.dim(`[${s.transport}]`)} ${pc.dim(s.permissions.join(", "))}` +
        `  ${SEV_COLOR[s.risk](s.risk)}`
    );
    line(`      ${pc.dim(s.note)}`);
  }

  if (scan.findings.length > 0) {
    heading("Findings");
    const sorted = [...scan.findings].sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
    for (const f of sorted) {
      line(`  ${SEV_COLOR[f.severity](f.severity.toUpperCase().padEnd(8))} ${pc.dim(f.ruleId)}  ${f.title}`);
      if (f.redactedEvidence) line(`      ${pc.dim("evidence:")} ${truncate(f.redactedEvidence, 100)}`);
      line(`      ${sym.arrow} ${pc.dim(f.recommendedAction)}`);
    }
  }

  const blocked = hasBlockingFindings(scan.findings, scan.policy);
  heading("Result");
  if (scan.findings.length === 0) {
    line(`  ${pc.green("No MCP risks detected.")}`);
  } else if (blocked) {
    const threshold = scan.policy.failOn ?? "high";
    line(`  ${pc.red(`Findings at or above '${threshold}'.`)} ${pc.dim("Review the recommendations above.")}`);
    process.exitCode = 1;
  } else {
    line(`  ${pc.yellow("Findings recorded below the failOn threshold.")} ${pc.dim("Review when convenient.")}`);
  }
  line("");
}

function sevRank(s: RiskSeverity): number {
  return ["info", "low", "medium", "high", "critical"].indexOf(s);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
