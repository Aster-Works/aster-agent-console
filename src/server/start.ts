/**
 * Standalone collector entrypoint (used by `pnpm serve` and as a reference for
 * the CLI). Binds to 127.0.0.1 only. Env overrides: AAC_PORT, AAC_DB, AAC_WEB.
 */
import { createServer, PORT } from "./index";
import { DEFAULT_DB_PATH } from "../db/index";

const port = Number(process.env.AAC_PORT ?? PORT);
const dbPath = process.env.AAC_DB ?? DEFAULT_DB_PATH;
const webDir = process.env.AAC_WEB || undefined;

const srv = createServer({ port, dbPath, webDir, importCodex: true });
srv
  .start()
  .then(({ host, port }) => {
    // eslint-disable-next-line no-console
    console.log(`Aster Agent Audit collector → http://${host}:${port}  (db: ${dbPath})`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start collector:", err);
    process.exit(1);
  });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    srv.close();
    process.exit(0);
  });
}
