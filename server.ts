import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import next from "next";
import { runMigrations } from "@/server/db/migrate";
import { log } from "@/lib/log";
import { mounts } from "@/server/http/mounts";
import { startWorker } from "@/worker/start";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

await runMigrations();
const app = next({ dev, dir: process.cwd() });
await app.prepare();
const handle = app.getRequestHandler();
const mounted = await mounts();

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    for (const m of mounted) {
      if (req.url && (req.url === m.prefix || req.url.startsWith(m.prefix + "/") || req.url.startsWith(m.prefix + "?"))) {
        return await m.handle(req, res);
      }
    }
    await handle(req, res);
  } catch (e) {
    log.error({ err: e, url: req.url }, "request failed");
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end("Internal error");
    }
  }
});

server.listen(port, () => log.info({ port, dev }, "sentire-cloud listening"));

// ROLE=all (default) also runs background jobs in this process; ROLE=web leaves them to a separate worker.
if ((process.env.ROLE ?? "all") === "all") await startWorker();
process.on("SIGTERM", () => server.close(() => process.exit(0)));
