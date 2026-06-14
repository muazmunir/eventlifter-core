import { ChannelKey } from "../types";
import { DEFAULT_JOB_OPTS, publishQueue, syncInQueue } from "./queues";

/**
 * Enqueue a publish for each target channel. The jobId is the idempotency key —
 * a double-click or retry can't create two Eventbrite events because BullMQ
 * dedupes on jobId.
 */
export async function enqueuePublish(eventId: string, hostId: string, targets: ChannelKey[]): Promise<void> {
  await Promise.all(
    targets.map((channel) =>
      publishQueue.add(
        "publish",
        { eventId, hostId, channel },
        { ...DEFAULT_JOB_OPTS, jobId: `${eventId}:${channel}:publish` }
      )
    )
  );
}

/** Schedule attendee pulls. Webhook channels also get a nightly pull as a backstop. */
export async function enqueueAttendeePull(
  eventId: string,
  hostId: string,
  channel: ChannelKey,
  since?: Date
): Promise<void> {
  await syncInQueue.add(
    "pull_attendees",
    { eventId, hostId, channel, sinceIso: since?.toISOString() },
    DEFAULT_JOB_OPTS
  );
}
