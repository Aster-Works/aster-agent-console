/**
 * Team policy (Phase 6). Mirrors AsterGuard's `.aster-guard/policy.json`:
 *   allowedMcpHosts  — remote MCP hosts the user has vetted (AAC-MCP-005 skips them)
 *   ignoreRules      — rule ids to suppress everywhere (display + scan exit code)
 *   failOn           — severity that makes `aster-audit scan` exit non-zero
 *
 * Policy is advisory over the *display* of findings and the scan exit code. It
 * never changes what is collected — the DB keeps the honest record; policy only
 * filters what the Risk Radar surfaces. This keeps the tool trustworthy: a user
 * who has vetted their own remote host can silence the noise without hiding it
 * from the raw log.
 */
import type { RiskSeverity } from "./types";
import { SEVERITY_ORDER } from "./types";

export type ConsolePolicy = {
  allowedMcpHosts?: string[];
  ignoreRules?: string[];
  failOn?: RiskSeverity | "never";
};

/** `example.com` matches exactly; `*.example.com` matches any subdomain and the apex. */
export function hostAllowed(host: string, allow: string[] = []): boolean {
  const h = host.toLowerCase();
  return allow.some((raw) => {
    const a = raw.trim().toLowerCase();
    if (!a) return false;
    if (a.startsWith("*.")) {
      const domain = a.slice(1); // ".example.com"
      return h === a.slice(2) || h.endsWith(domain);
    }
    return h === a;
  });
}

/** Drop findings whose ruleId is listed in policy.ignoreRules. */
export function applyPolicy<T extends { ruleId: string }>(
  findings: T[],
  policy?: ConsolePolicy
): T[] {
  const ignore = policy?.ignoreRules;
  if (!ignore || ignore.length === 0) return findings;
  const set = new Set(ignore);
  return findings.filter((f) => !set.has(f.ruleId));
}

/**
 * True when any finding is at or above the policy's failOn severity. Used by the
 * `scan` command to set a non-zero exit code (CI / pre-flight gate). Default
 * threshold is "high" — high and critical fail, medium and below do not.
 */
export function hasBlockingFindings(
  findings: { severity: RiskSeverity }[],
  policy?: ConsolePolicy
): boolean {
  const failOn = policy?.failOn ?? "high";
  if (failOn === "never") return false;
  const threshold = SEVERITY_ORDER.indexOf(failOn);
  return findings.some((f) => SEVERITY_ORDER.indexOf(f.severity) >= threshold);
}
