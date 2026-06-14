import { Queue, JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { ChannelKey } from "../types";

/**
 * Shared Redis connection + queue definitions.
 * maxRetriesPerRequest: null is required by BullMQ for the connection it owns.
 */
export const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

/** Default retry policy for channel-facing jobs: 5 tries, exponential backoff. */
export const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

export type PublishJob = { eventId: string; hostId: string; channel: ChannelKey };
export type SyncInJob = { eventId: string; hostId: string; channel: ChannelKey; sinceIso?: string };
export type WebhookJob = { channel: ChannelKey; webhookEventId: string; payload: unknown };

export const publishQueue = new Queue<PublishJob>("publish", { connection });
export const syncInQueue = new Queue<SyncInJob>("sync-in", { connection });
export const webhookQueue = new Queue<WebhookJob>("webhook", { connection });
