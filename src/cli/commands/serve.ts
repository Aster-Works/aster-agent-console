/**
 * `aster-audit serve` — run the collector headlessly (no browser). This is what
 * the background service (launchd) runs so events are collected even when no
 * dashboard is open. Logs go to stdout/stderr, which the service captures.
 */
import { mkdirSync, existsSync } from "node:fs";
import { createServer } from "../../server/index";
import { openDb } from "../../db/index";
import { importSpool } from "../../server/spool";
import { CONFIG_DIR, DB_PATH, SPOOL_DIR, PORT, HOST, findWebDir } from "../util/paths";

export async function serve(opts: { port?: number; db?: string } = {}): Promise<void> {
  const port = opts.port ?? PORT;
  const dbPath = opts.db ?? DB_PATH;
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });

  const db = openDb(dbPath);
  const webDir = findWebDir();
  const srv = createServer({ db, dbPath, host: HOST, port, webDir, importCodex: true });

  try {
    const started = await srv.start();
    const imported = importSpool(srv.collector, SPOOL_DIR);
    // eslint-disable-next-line no-console
    console.log(
      `[${new Date().toISOString()}] aster-audit collector serving http://${started.host}:${started.port} · db=${dbPath} · imported ${imported} spooled event(s)`
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[aster-audit] could not bind ${HOST}:${port}: ${(err as Error).message}`);
    db.close();
    process.exit(1);
    return;
  }

  const shutdown = () => {
    srv.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
