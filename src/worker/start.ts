import { boss } from "@/server/jobs/queue";
import { log } from "@/lib/log";
import { jobs } from "./jobs";

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
  log.info({ jobs: jobs.map((j) => j.name) }, "worker started");
  return b;
}
