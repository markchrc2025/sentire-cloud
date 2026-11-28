import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import next from "next";
import { runMigrations } from "@/server/db/migrate";
import { log } from "@/lib/log";
import { mounts } from "@/server/http/mounts";
import { startWorker } from "@/worker/start";
import { ensureRegistry } from "@/server/account/registry";
import { seedCatalog } from "@/server/billing/catalog";
import { refreshEverything, wire } from "@/server/wire";
import { bootstrapStaff } from "@/server/admin/bootstrap";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

await runMigrations();
await ensureRegistry();
await seedCatalog();
wire();
await bootstrapStaff();
// Entitlements are derived: recompute on boot so subscriptions paid before an upgrade of Sentire Cloud get theirs (idempotent).
await refreshEverything();
// Server action redirects fetch the target page from this same process. Behind the proxy the request says https,
// but the process itself listens on plain http, so give Next the internal origin.
process.env.__NEXT_PRIVATE_ORIGIN ??= `http://127.0.0.1:${port}`;
const app = next({ dev, dir: process.cwd(), port, hostname: "localhost" });
await app.prepare();
const handle = app.getRequestHandler();
const mounted = await mounts();

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    // status.sentire.solutions serves the public status page at its root.
    if (req.headers.host?.startsWith("status.") && (req.url === "/" || req.url?.startsWith("/?"))) req.url = "/status";
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
