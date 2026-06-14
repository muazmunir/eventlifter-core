import { Worker } from "bullmq";
import { ChannelRegistry, ChannelHttpError } from "../channels/adapter";
import { PublishOrchestrator } from "../services/publish";
import { dedupeKey } from "../services/webhooks";
import { ConnectionStore, EventStore, RegistrationStore } from "../ports";
import { connection, PublishJob, SyncInJob } from "./queues";

/**
 * Workers run in their own process (separate from the API). Each pulls the
 * master event + connection from storage, calls the adapter via the
 * orchestrator, and persists the result. Failures bubble up so BullMQ retries —
 * EXCEPT auth errors, which flip the connection to "expired" and stop retrying
 * (a bad token won't fix itself).
 */
export function startWorkers(deps: {
  registry: ChannelRegistry;
  connections: ConnectionStore;
  events: EventStore;
  registrations: RegistrationStore;
}) {
  const orchestrator = new PublishOrchestrator(deps.registry);

  const publishWorker = new Worker<PublishJob>(
    "publish",
    async (job) => {
      const { eventId, hostId, channel } = job.data;
      const master = await deps.events.getMaster(eventId);
      if (!master) throw new Error(`Master event ${eventId} not found`);
      const conn = await deps.connections.get(hostId, channel);

      const result = await orchestrator.publishOne(master, channel, conn ?? undefined);
      await deps.events.saveExternalRef(eventId, result);

      if (result.status === "failed") {
        if (/reconnect required/.test(result.error ?? "")) {
          // auth error → mark expired, do NOT retry
          await deps.connections.setStatus(hostId, channel, "expired", result.error);
          return result; // resolve so BullMQ won't retry
        }
        throw new Error(result.error); // transient → let BullMQ back off + retry
      }
      return result;
    },
    { connection }
  );

  const syncWorker = new Worker<SyncInJob>(
    "sync-in",
    async (job) => {
      const { eventId, hostId, channel, sinceIso } = job.data;
      const adapter = deps.registry.get(channel);
      if (!adapter.capabilities.pullAttendees || !adapter.fetchAttendees) return { skipped: true };

      const ref = await deps.events.getExternalRef(eventId, channel);
      if (!ref) return { skipped: true };
      const conn = await deps.connections.get(hostId, channel);
      if (!conn) return { skipped: true };

      const since = sinceIso ? new Date(sinceIso) : undefined;
      const regs = await adapter.fetchAttendees(ref, conn, since);
      for (const reg of regs) {
        // ingest is dumb + idempotent; matching (dedupeKey) happens in a later step
        void dedupeKey(reg);
        await deps.registrations.upsertRegistration(eventId, reg);
      }
      return { pulled: regs.length };
    },
    { connection }
  );

  for (const w of [publishWorker, syncWorker]) {
    w.on("failed", (job, err) => {
      const e = err as ChannelHttpError;
      console.error(`[${w.name}] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, e.message);
    });
  }

  return { publishWorker, syncWorker };
}
