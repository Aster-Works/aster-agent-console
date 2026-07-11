/**
 * `aster-audit verify [--session <id>] [--format json]` — verify the event
 * hash chain. Read-only.
 *
 * What this proves and what it does not (D9): the chain makes after-the-fact
 * modification of stored events DETECTABLE — it does not prevent someone who
 * can write the SQLite file from rewriting the whole chain. Events stored
 * before chaining existed report as "legacy-unverified", an honest third
 * state. Enrichment-mutable fields (title/links/metrics/receivedAt) are
 * outside the hash by design; see core/integrity.
 *
 * Exit codes: 0 = no broken chains (verified/legacy only), 1 = break found.
 */
import pc from "picocolors";
import { verifyChain, type VerifyResult } from "../../core/integrity/index";
import { openDb } from "../../db/index";
import { DB_PATH } from "../util/paths";
import { brand, check, heading, line } from "../util/ui";

export type SessionVerdict = VerifyResult & { sessionId: string };

export function verifySessions(dbPath: string, sessionId?: string): SessionVerdict[] {
  const db = openDb(dbPath);
  try {
    const ids = sessionId ? [sessionId] : db.sessionIds();
    return ids.map((id) => ({ sessionId: id, ...verifyChain(db.integrityRows(id)) }));
  } finally {
    db.close();
  }
}

export function verifyCmd(opts: { session?: string; format?: string; db?: string }): void {
  const dbPath = opts.db ?? DB_PATH;
  const verdicts = verifySessions(dbPath, opts.session);
  const broken = verdicts.filter((v) => v.status === "broken");
  const verified = verdicts.filter((v) => v.status === "verified");
  const legacy = verdicts.filter((v) => v.status === "legacy-unverified");

  if (opts.format === "json") {
    // Machine-readable: everything on stdout, nothing else.
    console.log(
      JSON.stringify(
        {
          db: dbPath,
          sessions: verdicts.length,
          verified: verified.length,
          legacyUnverified: legacy.length,
          broken: broken.length,
          verdicts,
        },
        null,
        2
      )
    );
    if (broken.length) process.exitCode = 1;
    return;
  }

  brand();
  heading("Audit-chain verification");
  line(`  ${pc.dim(dbPath)}`);
  if (verdicts.length === 0) {
    check("warn", "No sessions", opts.session ? `session ${opts.session} has no events` : "database is empty");
    line("");
    return;
  }
  check(true, "Sessions verified", `${verified.length} intact (${verified.reduce((n, v) => n + v.checked, 0)} events checked)`);
  if (legacy.length) {
    check(
      "warn",
      "Legacy (unverified)",
      `${legacy.length} session(s) predate hash chaining — cannot be verified, which is different from being broken`
    );
  }
  for (const b of broken) {
    check(false, `BROKEN ${b.sessionId}`, `${b.breakAt?.eventId}: ${b.breakAt?.reason}`);
  }
  heading("Result");
  if (broken.length) {
    line(`  ${pc.red(`${broken.length} session(s) failed verification.`)} ${pc.dim("The events named above changed after they were recorded.")}`);
    process.exitCode = 1;
  } else {
    line(`  ${pc.green("No breaks detected.")} ${pc.dim("Modification of hashed events would have been detected; this is tamper-evidence, not tamper-proofing.")}`);
  }
  line("");
}
