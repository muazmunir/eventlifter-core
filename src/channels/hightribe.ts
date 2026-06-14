import { ChannelAdapter } from "./adapter";
import {
  ChannelCapabilities,
  Connection,
  DomainEvent,
  ExternalRef,
  MasterEvent,
  RawRegistration,
} from "../types";

/**
 * HighTribe — native channel. No external auth; this calls HighTribe's own
 * event service directly. Full capabilities.
 *
 * STUBBED: wire `client` to your real HighTribe event service (HTTP client,
 * gRPC, or a direct module import). The shape below is what the orchestrator
 * expects; swap the bodies for real calls.
 */
export interface HighTribeClient {
  createEvent(hostId: string, master: MasterEvent): Promise<{ id: string; url: string }>;
  updateEvent(eventId: string, master: MasterEvent): Promise<void>;
  cancelEvent(eventId: string): Promise<void>;
  listRegistrations(eventId: string, since?: Date): Promise<RawRegistration[]>;
}

export class HighTribeAdapter implements ChannelAdapter {
  readonly key = "hightribe" as const;
  readonly authType = "native" as const;
  readonly capabilities: ChannelCapabilities = {
    publish: true,
    update: true,
    unpublish: true,
    pullAttendees: true,
    webhooks: true,
    pricing: true,
    capacitySync: true,
  };

  constructor(private client: HighTribeClient) {}

  async publish(master: MasterEvent, conn: Connection): Promise<ExternalRef> {
    const hostId = conn.credentials.internalHostId ?? master.hostId;
    const created = await this.client.createEvent(hostId, master);
    return { channel: this.key, externalEventId: created.id, externalEventUrl: created.url };
  }

  async update(ref: ExternalRef, master: MasterEvent): Promise<void> {
    await this.client.updateEvent(ref.externalEventId, master);
  }

  async unpublish(ref: ExternalRef): Promise<void> {
    await this.client.cancelEvent(ref.externalEventId);
  }

  async fetchAttendees(ref: ExternalRef, _conn: Connection, since?: Date): Promise<RawRegistration[]> {
    return this.client.listRegistrations(ref.externalEventId, since);
  }

  async parseWebhook(payload: unknown): Promise<DomainEvent[]> {
    // HighTribe emits its own internal events; map them straight through.
    const p = payload as { type?: string; registration?: RawRegistration };
    if (p.type === "registration" && p.registration) {
      return [{ type: "registration.upsert", registration: { ...p.registration, channel: this.key } }];
    }
    return [];
  }
}
