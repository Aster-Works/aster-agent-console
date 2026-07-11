/**
 * Codex rollout importer. Codex has no per-tool hook (its single `notify` slot
 * only fires on turn-complete and can't be shared), so its real work log lives
 * in ~/.codex/sessions/<date>/rollout-*.jsonl. This watcher tails those files and
 * feeds them through the same collector pipeline as Claude hook events —
 * redaction, risk detection, file changes, and token/cost enrichment all apply.
 *
 * Read-only: it never writes to or executes anything from the rollouts. Files
 * are read only if they canonicalize inside ~/.codex/sessions (untrusted-path
 * guard) and only rollouts modified within the retention window are scanned.
 * A per-file processed-line offset makes re-scans idempotent and cheap.
 */
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentName } from "../core/types";
import { parseCodexRollout } from "../core/codex-rollout";
import { DEFAULT_CONFIG_DIR } from "../db/index";

const DEFAULT_ROOT = join(homedir(), ".codex", "sessions");
// Resolved via the shared dir resolution (legacy fallback until `migrate` runs).
const DEFAULT_STATE = join(DEFAULT_CONFIG_DIR, "codex-import.json");
const MAX_ROLLOUT_BYTES = 128 * 1024 * 1024;
const DEFAULT_INTERVAL_MS = 5000;

type Collector = {
  ingest: (
    agent: AgentName,
    payload: unknown,
    opts?: { id?: string; source?: "import" }
  ) => unknown;
};

type FileState = { lines: number; mtime: number };
type State = Record<string, FileState>;

export type CodexImporterOptions = {
  collector: Collector;
  root?: string;
  stateFile?: string;
  /** only scan rollouts modified within this many days (0 = no limit) */
  retentionDays?: number;
  intervalMs?: number;
};

function loadState(file: string): State {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as State;
  } catch {
    return {};
  }
}

function saveState(file: string, state: State): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state));
  } catch {
    /* non-fatal: worst case we re-scan (offsets dedup via deterministic ids) */
  }
}

/** List rollout files newer than the cutoff (bounded), newest first. */
function walkRollouts(root: string, cutoffMs: number): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
        try {
          if (statSync(p).mtimeMs >= cutoffMs) out.push(p);
        } catch {
          /* skip unreadable */
        }
      }
    }
  };
  walk(root);
  out.sort((a, b) => (a < b ? 1 : -1));
  return out;
}

/** Read a rollout only if it canonicalizes inside `root` (untrusted-path guard). */
function safeRead(path: string, root: string): string | null {
  try {
    const real = realpathSync(path);
    const realRoot = realpathSync(root);
    if (real !== realRoot && !real.startsWith(realRoot + "/")) return null;
    const st = statSync(real);
    if (!st.isFile() || st.size > MAX_ROLLOUT_BYTES) return null;
    return readFileSync(real, "utf8");
  } catch {
    return null;
  }
}

export function createCodexImporter(opts: CodexImporterOptions) {
  const root = opts.root ?? DEFAULT_ROOT;
  const stateFile = opts.stateFile ?? DEFAULT_STATE;
  const retentionDays = opts.retentionDays ?? 30;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  /** One scan pass. Returns the number of events ingested. */
  function pollOnce(): number {
    const state = loadState(stateFile);
    const cutoff = retentionDays > 0 ? Date.now() - retentionDays * 86_400_000 : 0;
    let ingested = 0;
    let changed = false;

    for (const file of walkRollouts(root, cutoff)) {
      let st: import("node:fs").Stats;
      try {
        st = statSync(file);
      } catch {
        continue;
      }
      const prev = state[file];
      if (prev && prev.mtime === st.mtimeMs) continue; // unchanged since last scan

      const text = safeRead(file, root);
      if (text == null) continue;

      try {
        const { events, processedLines } = parseCodexRollout(text, file, prev?.lines ?? 0);
        for (const e of events) {
          try {
            opts.collector.ingest("codex", e.payload, { id: e.id, source: "import" });
            ingested++;
          } catch {
            /* one bad synthetic event must not abort the file */
          }
        }
        state[file] = { lines: processedLines, mtime: st.mtimeMs };
        changed = true;
      } catch {
        /* skip an unparseable file; try again next scan */
      }
    }

    if (changed) saveState(stateFile, state);
    return ingested;
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  function start(): void {
    // Kick off the first (potentially bulk) scan off the startup path.
    const first = setTimeout(() => {
      try {
        pollOnce();
      } catch {
        /* non-fatal */
      }
    }, 200);
    first.unref?.();
    timer = setInterval(() => {
      try {
        pollOnce();
      } catch {
        /* non-fatal */
      }
    }, intervalMs);
    timer.unref?.();
  }
  function stop(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  return { pollOnce, start, stop };
}
