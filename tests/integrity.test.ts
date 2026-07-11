import { describe, it, expect } from "vitest";
import {
  CHAIN_GENESIS,
  canonicalize,
  computeEventHash,
  verifyChain,
  type ChainedEvent,
} from "../src/core/integrity/index";
import type { NormalizedAgentEvent } from "../src/core/types";

const ev = (id: string, over: Partial<NormalizedAgentEvent> = {}): NormalizedAgentEvent => ({
  id,
  agent: "claude-code",
  source: "hook",
  type: "post_tool_use",
  sessionId: "s1",
  timestamp: "2026-07-11T00:00:00Z",
  receivedAt: "2026-07-11T00:00:00Z",
  title: "Bash complete",
  ...over,
});

/** Build a well-formed chain over the given events. */
function chain(events: NormalizedAgentEvent[]): ChainedEvent[] {
  const out: ChainedEvent[] = [];
  let prev: string | null = null;
  for (const e of events) {
    const hash = computeEventHash(e, prev);
    out.push({ event: e, prevHash: prev ?? CHAIN_GENESIS, hash });
    prev = hash;
  }
  return out;
}

describe("canonicalize", () => {
  it("is key-order independent at every depth", () => {
    expect(canonicalize({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 2 } })).toBe(
      canonicalize({ a: { c: 2, d: [1, { y: 2, z: 1 }] }, b: 1 })
    );
  });
  it("treats an undefined member and an absent member identically", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });
  it("preserves array order (order is data)", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });
});

describe("hash chain", () => {
  it("same event + same predecessor → same hash, always", () => {
    expect(computeEventHash(ev("e1"), null)).toBe(computeEventHash(ev("e1"), null));
    expect(computeEventHash(ev("e1"), null)).not.toBe(computeEventHash(ev("e1"), "otherprev"));
  });

  it("verifies an intact chain", () => {
    const rows = chain([ev("e1"), ev("e2"), ev("e3")]);
    expect(verifyChain(rows)).toEqual({ status: "verified", checked: 3, legacy: 0 });
  });

  it("detects content tampering and names the event", () => {
    const rows = chain([ev("e1"), ev("e2"), ev("e3")]);
    rows[1] = {
      ...rows[1],
      event: { ...rows[1].event, input: { value: { command: "edited after the fact" }, redactions: [] } },
    };
    const r = verifyChain(rows);
    expect(r.status).toBe("broken");
    expect(r.breakAt?.eventId).toBe("e2");
    expect(r.breakAt?.reason).toContain("does not match its stored hash");
  });

  it("enrichment-mutable fields (title/links/metrics/receivedAt) do NOT affect the hash — documented exemption", () => {
    const base = ev("e1");
    const enriched: NormalizedAgentEvent = {
      ...base,
      title: "rewritten by enrichment",
      links: { files: ["/repo/a.ts"], commitSha: "abc123" },
      metrics: { durationMs: 42 },
      receivedAt: "2026-07-12T09:09:09Z", // re-import re-stamps this
    };
    expect(computeEventHash(enriched, null)).toBe(computeEventHash(base, null));
    // …while the observed core IS covered:
    expect(computeEventHash({ ...base, summary: "changed" }, null)).not.toBe(computeEventHash(base, null));
  });

  it("detects a deleted event (link mismatch)", () => {
    const rows = chain([ev("e1"), ev("e2"), ev("e3")]);
    rows.splice(1, 1); // e2 vanishes
    const r = verifyChain(rows);
    expect(r.status).toBe("broken");
    expect(r.breakAt?.eventId).toBe("e3");
    expect(r.breakAt?.reason).toContain("prevHash mismatch");
  });

  it("pre-integrity rows verify as legacy-unverified, not as broken", () => {
    const rows: ChainedEvent[] = [
      { event: ev("old1"), prevHash: null, hash: null },
      { event: ev("old2"), prevHash: null, hash: null },
    ];
    expect(verifyChain(rows)).toEqual({ status: "legacy-unverified", checked: 0, legacy: 2 });
  });

  it("legacy prefix + hashed suffix verifies; a legacy row AFTER hashed rows is a gap", () => {
    const hashed = chain([ev("new1"), ev("new2")]);
    const mixed: ChainedEvent[] = [{ event: ev("old1"), prevHash: null, hash: null }, ...hashed];
    expect(verifyChain(mixed)).toEqual({ status: "verified", checked: 2, legacy: 1 });

    const gap: ChainedEvent[] = [...hashed, { event: ev("old2"), prevHash: null, hash: null }];
    const r = verifyChain(gap);
    expect(r.status).toBe("broken");
    expect(r.breakAt?.reason).toContain("chain gap");
  });

  it("an empty stream verifies (0 checked)", () => {
    expect(verifyChain([])).toEqual({ status: "verified", checked: 0, legacy: 0 });
  });
});
