/**
 * Evidence bundle (REFACTOR_PLAN.md Phase 3, brief §5.3): one self-contained,
 * machine-readable JSON document a user can hand to a reviewer — events with
 * their chain hashes, findings, the effective policy, and the verification
 * result computed AT EXPORT TIME, all under explicit metadata (product
 * version, schema versions, filters, timestamp).
 *
 * Honesty properties:
 *  - Events are exported exactly as stored (already redacted at ingest;
 *    redaction is best-effort pattern matching, and the bundle says so).
 *  - The verification verdict inside the bundle describes the store at export
 *    time. The bundle itself is a plain file — its own integrity after export
 *    is out of scope here (a signed manifest is a Pro-tier design, §Phase 6).
 *  - No field is invented: anything unknown is absent, not defaulted.
 */
import type { NormalizedAgentEvent } from "../core/types";
import type { RiskRow } from "../core/views";
import { INTEGRITY_SCHEMA_VERSION, verifyChain, type VerifyResult } from "../core/integrity/index";
import type { PolicySource, PolicyV1 } from "../core/policy";
import type { AgentConsoleDb } from "../db/index";
import { PRODUCT_NAME } from "../core/branding";

export type EvidenceBundle = {
  meta: {
    product: string;
    productVersion: string;
    integritySchemaVersion: number;
    dbSchemaVersion: number;
    exportedAt: string;
    filters: { sessionId?: string };
    redaction: string;
  };
  verification: Array<VerifyResult & { sessionId: string }>;
  policy: { effective: PolicyV1; sources: PolicySource[] };
  counts: { sessions: number; events: number; findings: number };
  events: Array<NormalizedAgentEvent & { prevHash: string | null; hash: string | null }>;
  findings: RiskRow[];
};

export function buildEvidenceBundle(
  db: AgentConsoleDb,
  opts: {
    productVersion: string;
    sessionId?: string;
    policy: { effective: PolicyV1; sources: PolicySource[] };
  }
): EvidenceBundle {
  const sessionIds = opts.sessionId ? [opts.sessionId] : db.sessionIds();

  const events: EvidenceBundle["events"] = [];
  const verification: EvidenceBundle["verification"] = [];
  for (const sid of sessionIds) {
    const rows = db.integrityRows(sid);
    verification.push({ sessionId: sid, ...verifyChain(rows) });
    for (const r of rows) events.push({ ...r.event, prevHash: r.prevHash, hash: r.hash });
  }

  const wanted = new Set(sessionIds);
  const findings = db.getRisk().filter((f) => wanted.has(f.sessionId));

  return {
    meta: {
      product: PRODUCT_NAME,
      productVersion: opts.productVersion,
      integritySchemaVersion: INTEGRITY_SCHEMA_VERSION,
      dbSchemaVersion: db.raw.pragma("user_version", { simple: true }) as number,
      exportedAt: new Date().toISOString(),
      filters: opts.sessionId ? { sessionId: opts.sessionId } : {},
      redaction:
        "Events are redacted before storage (best-effort, pattern-based). This bundle contains the stored, redacted records only.",
    },
    verification,
    policy: opts.policy,
    counts: { sessions: sessionIds.length, events: events.length, findings: findings.length },
    events,
    findings,
  };
}
