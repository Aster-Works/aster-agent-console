/**
 * `aster-audit report --type evidence [--session <id>] [--out <file>]`
 *
 * Report types land incrementally. `evidence` is implemented; the others
 * (security / activity / html) come with Phase 5 and FAIL LOUDLY until then —
 * a report command that pretends to succeed would be worse than none.
 */
import { writeFileSync } from "node:fs";
import pc from "picocolors";
import { buildEvidenceBundle } from "../../server/evidence";
import { loadPolicyChain } from "../../server/mcp-scan";
import { openDb } from "../../db/index";
import { CONFIG_DIR, DB_PATH } from "../util/paths";
import { line } from "../util/ui";

// Stamped by tsup; "dev" under tsx.
declare const __AAC_VERSION__: string;
const VERSION = typeof __AAC_VERSION__ === "string" ? __AAC_VERSION__ : "dev";

const IMPLEMENTED = ["evidence"] as const;

export function reportCmd(opts: { type?: string; session?: string; out?: string; db?: string }): void {
  const type = opts.type ?? "evidence";
  if (!(IMPLEMENTED as readonly string[]).includes(type)) {
    console.error(
      `report --type ${type} is not implemented yet (available: ${IMPLEMENTED.join(", ")}). ` +
        `Nothing was generated.`
    );
    process.exitCode = 2;
    return;
  }

  const db = openDb(opts.db ?? DB_PATH);
  try {
    const chain = loadPolicyChain(CONFIG_DIR, process.cwd());
    const bundle = buildEvidenceBundle(db, {
      productVersion: VERSION,
      sessionId: opts.session,
      policy: { effective: chain.policy, sources: chain.sources },
    });
    const json = JSON.stringify(bundle, null, 2);
    if (opts.out) {
      writeFileSync(opts.out, json);
      line(
        `${pc.green("✔")} Evidence bundle written to ${opts.out} ` +
          pc.dim(`(${bundle.counts.sessions} sessions, ${bundle.counts.events} events, ${bundle.counts.findings} findings)`)
      );
    } else {
      console.log(json);
    }
  } finally {
    db.close();
  }
}
