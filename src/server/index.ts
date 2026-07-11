/**
 * Local server (02 §4). Binds to 127.0.0.1 only, accepts JSON only, enforces a
 * body-size limit, never executes incoming commands, and redacts before
 * persistence (inside the collector). Serves:
 *   POST /events            collector endpoint
 *   GET  /health            health probe
 *   GET  /api/*             dashboard data
 *   GET  /api/live          SSE live stream
 *   GET  *                  static dashboard (when webDir is provided)
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { accessSync, constants, existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { AgentName, CollectorStatus } from "../core/types";
import {
  openDb,
  FINDING_STATUSES,
  type AgentConsoleDb,
  type FindingStatus,
  DEFAULT_DB_PATH,
  DEFAULT_CONFIG_DIR,
} from "../db/index";
import { createCollector, type LiveMessage } from "./collector";
import { createCodexImporter } from "./codex-import";
import { assembleDataset } from "./dataset";
import { loadConfig, saveConfig, PRICING_FAMILIES } from "./config";
import { applyPricingOverrides, getPricing } from "./usage";
import { hooksStatus } from "../cli/hooks/installer";
import { riskRuleCatalog } from "../core/risk";
import { fingerprintServer, mcpRuleCatalog } from "../core/mcp";
import { scanMcpEnvironment } from "./mcp-scan";
import { createEnricher, limitConcurrency } from "./enrich";
import { execFileGitRunner, type GitRunner } from "./git";

export const HOST = "127.0.0.1";
export const PORT = 48321;
const MAX_BODY = 512 * 1024; // 512 KB

export type ServerOptions = {
  db?: AgentConsoleDb;
  dbPath?: string;
  host?: string;
  port?: number;
  /** absolute path to built dashboard assets (dist/web); optional */
  webDir?: string;
  /** inject a git runner (tests pass a fake); defaults to the real git binary */
  gitRunner?: GitRunner;
  /** disable git enrichment entirely (e.g. unit tests) */
  enrich?: boolean;
  /** drop history older than this many days (default 30; 0 disables). */
  retentionDays?: number;
  /** tail ~/.codex/sessions rollouts into the collector (real entrypoints only). */
  importCodex?: boolean;
};

export function createServer(opts: ServerOptions = {}) {
  const db = opts.db ?? openDb(opts.dbPath ?? DEFAULT_DB_PATH);
  const host = opts.host ?? HOST;
  const port = opts.port ?? PORT;

  // Persisted, user-editable settings. Pricing overrides take effect for all
  // cost estimates; retention is enforced below (and re-applied on PATCH).
  const cfg = loadConfig();
  applyPricingOverrides(cfg.pricing);

  // Retention: enforce on startup and every 12h so the local DB stays bounded
  // even for an always-on background collector. Mutable so Settings can change
  // it live without a restart.
  let retentionDays = opts.retentionDays ?? cfg.retentionDays ?? 30;
  try {
    db.pruneOlderThan(retentionDays);
  } catch {
    /* non-fatal */
  }
  const pruneTimer = setInterval(() => {
    try {
      db.pruneOlderThan(retentionDays);
    } catch {
      /* non-fatal */
    }
  }, 12 * 60 * 60 * 1000);
  pruneTimer.unref?.();

  const clients = new Set<(data: string) => void>();
  function broadcast(msg: LiveMessage) {
    const data = JSON.stringify(msg);
    for (const send of clients) send(data);
  }
  const gitRunner = opts.gitRunner ?? execFileGitRunner();
  const enricher =
    opts.enrich === false ? undefined : limitConcurrency(createEnricher(db, gitRunner, broadcast));
  const collector = createCollector(db, broadcast, enricher);

  // Codex has no per-tool hook — tail its rollout logs into the same pipeline.
  // Off by default (unit tests must not read the real ~/.codex); the CLI
  // entrypoints opt in. The import-offset state lives next to the DB so running
  // against a different DB can never corrupt the real DB's offsets.
  const dbFile = opts.dbPath ?? DEFAULT_DB_PATH;
  const codexImporter = opts.importCodex
    ? createCodexImporter({
        collector,
        retentionDays,
        stateFile: dbFile === ":memory:" ? undefined : join(dirname(dbFile), "codex-import.json"),
      })
    : undefined;
  codexImporter?.start();

  function status(): CollectorStatus {
    return {
      mode: "live",
      online: true,
      host,
      port,
      dbPath: opts.dbPath ?? DEFAULT_DB_PATH,
      spooledEvents: 0,
    };
  }

  const app = new Hono();

  // Reject non-local Host headers (defense in depth against DNS rebinding).
  app.use("*", async (c, next) => {
    const hostHeader = c.req.header("host") ?? "";
    const h = hostHeader.split(":")[0];
    if (h && h !== "127.0.0.1" && h !== "localhost" && h !== "[::1]" && h !== "::1") {
      return c.json({ ok: false, error: "non-local host rejected" }, 403);
    }
    return next();
  });

  app.get("/health", (c) =>
    c.json({ ok: true, host, port, db: opts.dbPath ?? DEFAULT_DB_PATH, counts: db.counts() })
  );

  // Collector endpoint — JSON only, size-limited, never executes anything.
  app.post("/events", async (c) => {
    const len = Number(c.req.header("content-length") ?? "0");
    if (len > MAX_BODY) return c.json({ ok: false, error: "payload too large" }, 413);
    const ct = c.req.header("content-type") ?? "";
    if (!ct.includes("application/json")) {
      return c.json({ ok: false, error: "JSON only" }, 415);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid JSON" }, 400);
    }
    const { agent, payload } = (body ?? {}) as { agent?: AgentName; payload?: unknown };
    if (!payload || typeof payload !== "object") {
      return c.json({ ok: false, error: "missing payload" }, 400);
    }
    try {
      const result = collector.ingest((agent as AgentName) ?? "unknown", payload);
      return c.json(result);
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500);
    }
  });

  // ---- Dashboard API ----
  app.get("/api/dataset", (c) => {
    const ds = assembleDataset(db, status());
    if (!ds) return c.json({ empty: true });
    return c.json(ds);
  });
  app.get("/api/overview", (c) => {
    const ds = assembleDataset(db, status());
    return ds ? c.json(ds.overview) : c.json({ empty: true });
  });
  app.get("/api/sessions", (c) => c.json(db.getSessions()));
  app.get("/api/sessions/:id", (c) => {
    const s = db.getSession(c.req.param("id"));
    return s ? c.json(s) : c.json({ error: "not found" }, 404);
  });
  app.get("/api/sessions/:id/events", (c) => c.json(db.getEvents(c.req.param("id"))));
  app.get("/api/risk-findings", (c) => c.json(db.getRisk()));

  // Finding lifecycle. Findings are never deleted — the honest record is
  // kept; a status only changes what the active radar surfaces, and every
  // transition is appended to finding_status_history. (Deleting an
  // already-redacted audit record would not remove the real secret, which
  // lives in the agent's own logs — so we don't.)
  app.post("/api/risk-findings/resolve", async (c) => {
    let body: { id?: string; status?: string; note?: string };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ ok: false, error: "invalid JSON" }, 400);
    }
    if (!body.id) return c.json({ ok: false, error: "missing id" }, 400);
    const status = (body.status ?? "resolved") as FindingStatus;
    if (!FINDING_STATUSES.includes(status)) {
      return c.json({ ok: false, error: `invalid status (one of: ${FINDING_STATUSES.join(", ")})` }, 400);
    }
    const sessionId = db.setRiskStatus(body.id, status, body.note);
    if (!sessionId) return c.json({ ok: false, error: "not found" }, 404);
    db.recomputeSession(sessionId);
    return c.json({ ok: true });
  });
  app.get("/api/risk-findings/:id/history", (c) => c.json(db.getFindingHistory(c.req.param("id"))));

  // MCP inventory: reconcile the current config scan against what we remember
  // and report new / removed / changed servers. Recording on read is
  // deliberate — the inventory IS our observation log of the environment.
  app.get("/api/mcp-inventory", (c) => {
    const scan = scanMcpEnvironment({ configDir: dirname(dbFile) });
    const diff = db.recordMcpInventory(
      scan.inputs.map((i) => ({
        name: i.server.name,
        sourceFile: i.sourceFile,
        agent: i.agent,
        ...fingerprintServer(i.server),
      }))
    );
    return c.json({ inventory: db.getMcpInventory(), diff });
  });
  app.get("/api/repo-activity", (c) => {
    const ds = assembleDataset(db, status());
    return ds ? c.json(ds.repoActivity) : c.json({ empty: true });
  });
  function diagnostics() {
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    let writable = false;
    try {
      accessSync(DEFAULT_CONFIG_DIR, constants.W_OK);
      writable = true;
    } catch {
      /* not writable */
    }
    let dbOk = false;
    let counts: ReturnType<AgentConsoleDb["counts"]> | undefined;
    try {
      counts = db.counts();
      dbOk = true;
    } catch {
      /* unreadable */
    }
    return [
      { label: "Node.js ≥ 20", ok: nodeMajor >= 20, detail: `v${process.versions.node}` },
      { label: "Config directory writable", ok: writable, detail: DEFAULT_CONFIG_DIR },
      { label: "Local collector", ok: true, detail: `online · ${host}:${port}` },
      {
        label: "Database readable",
        ok: dbOk,
        detail: dbOk ? `${counts!.sessions} sessions · ${counts!.events} events` : "unreadable",
      },
    ];
  }

  function settingsPayload() {
    return {
      status: status(),
      dbPath: opts.dbPath ?? DEFAULT_DB_PATH,
      counts: db.counts(),
      retentionDays,
      pricing: getPricing(),
      pricingFamilies: PRICING_FAMILIES,
      agents: hooksStatus(),
      diagnostics: diagnostics(),
      rules: [...riskRuleCatalog(), ...mcpRuleCatalog()],
    };
  }

  app.get("/api/settings", (c) => c.json(settingsPayload()));

  // Update persisted settings (retention / pricing) and apply them live.
  app.patch("/api/settings", async (c) => {
    let body: { retentionDays?: number; pricing?: Record<string, [number, number, number, number]> };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ ok: false, error: "invalid JSON" }, 400);
    }
    const patch: { retentionDays?: number; pricing?: Record<string, [number, number, number, number]> } = {};
    if (typeof body.retentionDays === "number") patch.retentionDays = body.retentionDays;
    if (body.pricing && typeof body.pricing === "object") patch.pricing = body.pricing;

    const next = saveConfig(patch);
    retentionDays = next.retentionDays;
    applyPricingOverrides(next.pricing);
    try {
      db.pruneOlderThan(retentionDays);
    } catch {
      /* non-fatal */
    }
    return c.json(settingsPayload());
  });

  // ---- SSE live stream ----
  app.get("/api/live", (c) =>
    streamSSE(c, async (stream) => {
      const send = (data: string) => {
        stream.writeSSE({ data }).catch(() => {});
      };
      clients.add(send);
      let alive = true;
      stream.onAbort(() => {
        alive = false;
        clients.delete(send);
      });
      await stream.writeSSE({ data: JSON.stringify({ kind: "hello", counts: db.counts() }) });
      while (alive) {
        await stream.sleep(15000);
        if (!alive) break;
        await stream.writeSSE({ data: JSON.stringify({ kind: "ping" }) }).catch(() => {
          alive = false;
        });
      }
    })
  );

  // ---- Static dashboard (optional) ----
  if (opts.webDir && existsSync(opts.webDir)) {
    const webDir = opts.webDir;
    const rel = "./" + relative(process.cwd(), webDir).replace(/\\/g, "/");
    app.use("/assets/*", serveStatic({ root: rel }));
    app.get("*", (c) => {
      try {
        const html = readFileSync(join(webDir, "index.html"), "utf8");
        return c.html(html);
      } catch {
        return c.text("dashboard not built", 404);
      }
    });
  }

  let server: ServerType | undefined;
  function start(): Promise<{ host: string; port: number }> {
    return new Promise((resolve) => {
      server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
        resolve({ host, port: info.port });
      });
    });
  }
  function close() {
    clearInterval(pruneTimer);
    codexImporter?.stop();
    server?.close();
    db.close();
  }

  return { app, db, collector, broadcast, status, start, close };
}
