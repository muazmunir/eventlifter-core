import { ChannelRegistry, ChannelHttpError } from "../channels/adapter";
import { ChannelKey, Connection, MasterEvent, PublishResult } from "../types";

/**
 * Publish orchestrator.
 *
 * This is the logic that runs once per channel (in production, inside a BullMQ
 * job so each channel retries independently). It is deliberately
 * capability-gated: a channel that can't publish is marked "manual", never
 * errored. Partial failure is normal — Eventbrite succeeding while Luma 500s
 * does NOT roll back Eventbrite.
 */
export class PublishOrchestrator {
  constructor(private registry: ChannelRegistry) {}

  /**
   * Publish a master event to the given target channels.
   * `connections` is keyed by channel. In production each item below becomes an
   * enqueued job; here it runs them concurrently and collects per-channel results.
   */
  async publish(
    master: MasterEvent,
    targets: ChannelKey[],
    connections: Partial<Record<ChannelKey, Connection>>
  ): Promise<PublishResult[]> {
    const jobs = targets.map((channel) => this.publishOne(master, channel, connections[channel]));
    return Promise.all(jobs);
  }

  /** One channel. Safe to call as a BullMQ processor. */
  async publishOne(
    master: MasterEvent,
    channel: ChannelKey,
    connection?: Connection
  ): Promise<PublishResult> {
    if (!this.registry.has(channel)) {
      return { channel, status: "failed", error: `No adapter for "${channel}"` };
    }
    const adapter = this.registry.get(channel);

    // capability gate — never attempt what the channel can't do
    if (!adapter.capabilities.publish) {
      return { channel, status: "manual" };
    }
    if (!connection) {
      return { channel, status: "failed", error: `No connection for "${channel}"` };
    }

    try {
      const ref = await adapter.publish(master, connection);
      return { channel, status: "synced", ref };
    } catch (err) {
      const e = err as ChannelHttpError;
      // auth errors should flip the connection to "expired" upstream, not retry.
      const hint = e.isAuthError ? " (reconnect required)" : e.isRateLimited ? " (rate limited)" : "";
      return { channel, status: "failed", error: `${e.message}${hint}` };
    }
  }
}

/** Summarize per-channel results into a single event status. */
export function rollupStatus(results: PublishResult[]): "published" | "partial" | "failed" {
  const synced = results.filter((r) => r.status === "synced").length;
  const attempted = results.filter((r) => r.status !== "manual").length;
  if (synced === 0 && attempted > 0) return "failed";
  if (synced < attempted) return "partial";
  return "published";
}
