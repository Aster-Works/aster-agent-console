/**
 * Audit-trail integrity (REFACTOR_PLAN.md Phase 3, D9).
 *
 * Hash chaining makes the stored event stream TAMPER-EVIDENT — after-the-fact
 * edits, deletions, or insertions break the chain and are detectable. It is
 * NOT tamper-proofing: whoever can write the SQLite file can also rewrite the
 * whole chain. Say "detects modification", never "prevents" it.
 *
 *   eventHash = SHA-256( schemaVersion ":" previousHash ":" canonical(event) )
 *
 * Canonicalization is deterministic (sorted keys, no whitespace, unicode as
 * JSON escapes handled by JSON.stringify) so the same event always yields the
 * same hash on every platform. Events stored before chaining existed have no
 * hash and verify as "legacy-unverified" — an honest third state, distinct
 * from both "verified" and "broken".
 */
import { createHash } from "node:crypto";
import type { NormalizedAgentEvent } from "../types";

export const INTEGRITY_SCHEMA_VERSION = 1;

/** First link of every chain (per session). */
export const CHAIN_GENESIS = "genesis";

export type IntegrityStatus = "verified" | "broken" | "legacy-unverified";

export type ChainedEvent = {
  event: NormalizedAgentEvent;
  prevHash: string | null;
  hash: string | null;
};

export type VerifyResult = {
  status: IntegrityStatus;
  checked: number;
  legacy: number;
  /** First break, if any: which event and why. */
  breakAt?: { eventId: string; reason: string };
};

/**
 * Deterministic JSON: object keys sorted at every depth, arrays in order.
 * `undefined` object members vanish (as in JSON.stringify), so an absent and
 * an undefined field canonicalize identically.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortValue(x);
    }
    return out;
  }
  return v;
}

/**
 * The hashed projection of an event: its immutable observed core.
 *
 * Deliberately EXCLUDED (and therefore not tamper-evident — a documented
 * limitation, not an oversight):
 *  - title / links / metrics — legitimately rewritten by enrichment
 *    (enrichEvent UPDATEs them after insert); they are derived decoration,
 *    recomputable from the core, not part of what the agent did.
 *  - receivedAt — when the collector saw the event, not when the agent acted;
 *    re-importing the same rollout line after a cursor loss re-stamps it, and
 *    an idempotent re-import must not read as tampering.
 * Risk findings live in their own table and are not part of the event hash.
 */
export function integrityProjection(e: NormalizedAgentEvent): Record<string, unknown> {
  return {
    id: e.id,
    sessionId: e.sessionId,
    agent: e.agent,
    source: e.source,
    type: e.type,
    turnId: e.turnId,
    repoPath: e.repoPath,
    cwd: e.cwd,
    timestamp: e.timestamp,
    model: e.model,
    toolName: e.toolName,
    summary: e.summary,
    input: e.input,
    output: e.output,
    rawRef: e.rawRef,
  };
}

export function computeEventHash(event: NormalizedAgentEvent, previousHash: string | null): string {
  const prev = previousHash ?? CHAIN_GENESIS;
  return createHash("sha256")
    .update(`${INTEGRITY_SCHEMA_VERSION}:${prev}:${canonicalize(integrityProjection(event))}`)
    .digest("hex");
}

/**
 * Verify one session's chain, oldest first. Mixed streams are expected during
 * the transition: rows from before chaining verify as legacy; the chain is
 * only judged over the rows that carry hashes.
 */
export function verifyChain(rows: ChainedEvent[]): VerifyResult {
  let prev: string | null = null;
  let checked = 0;
  let legacy = 0;

  for (const row of rows) {
    if (row.hash === null) {
      // Pre-integrity row. A legacy row AFTER hashed rows would be a gap in
      // the chain — flag it instead of silently accepting.
      if (prev !== null) {
        return {
          status: "broken",
          checked,
          legacy,
          breakAt: { eventId: row.event.id, reason: "unhashed event after hashed events (chain gap)" },
        };
      }
      legacy++;
      continue;
    }
    if (row.prevHash !== prev && !(row.prevHash === CHAIN_GENESIS && prev === null)) {
      return {
        status: "broken",
        checked,
        legacy,
        breakAt: { eventId: row.event.id, reason: `prevHash mismatch (expected ${prev ?? CHAIN_GENESIS})` },
      };
    }
    const expect = computeEventHash(row.event, row.prevHash === CHAIN_GENESIS ? null : row.prevHash);
    if (expect !== row.hash) {
      return {
        status: "broken",
        checked,
        legacy,
        breakAt: { eventId: row.event.id, reason: "event content does not match its stored hash" },
      };
    }
    prev = row.hash;
    checked++;
  }

  if (checked === 0 && legacy > 0) return { status: "legacy-unverified", checked, legacy };
  return { status: "verified", checked, legacy };
}
