import { runMigrations } from "@/server/db/migrate";
import { log } from "@/lib/log";
import { startWorker } from "./start";

await runMigrations();
const b = await startWorker();
const stop = async () => {
  log.info("worker stopping");
  await b.stop({ graceful: true, timeout: 20000 });
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
