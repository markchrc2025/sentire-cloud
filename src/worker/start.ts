import { boss } from "@/server/jobs/queue";
import { log } from "@/lib/log";
import { jobs } from "./jobs";
import { sweepDeliveries } from "@/server/hub/deliver";

/** Register every job handler and schedule. Runs in the web process (ROLE=all, default) or alone (ROLE=worker). */
export async function startWorker() {
  const b = await boss();
  for (const job of jobs) {
    await b.createQueue(job.name);
    await b.work(job.name, { batchSize: 1 }, async ([j]) => {
      if (!j) return;
      const started = Date.now();
      try {
        await job.handler(j.data as never);
        log.info({ job: job.name, id: j.id, ms: Date.now() - started }, "job done");
      } catch (e) {
        log.error({ job: job.name, id: j.id, err: e }, "job failed");
        throw e;
      }
    });
    if (job.cron) await b.schedule(job.name, job.cron, {}, { tz: "Asia/Manila" });
  }
  // Event deliveries are swept every 10 seconds so apps hear of changes within a minute (FR-25).
  setInterval(() => void sweepDeliveries().catch((e) => log.error({ err: e }, "delivery sweep failed")), 10_000).unref();
  log.info({ jobs: jobs.map((j) => j.name) }, "worker started");
  return b;
}
