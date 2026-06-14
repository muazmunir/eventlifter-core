import { randomUUID } from "crypto";
import { ConnectionStore, EventStore, RegistrationStore } from "../ports";
import { ChannelKey, Connection, ExternalRef, MasterEvent, PublishResult, RawRegistration } from "../types";
import { decryptJson, encryptJson } from "../crypto";

/**
 * In-memory stores — let the server boot and be exercised with NO database.
 * Credentials are still encrypted (same path as production) so the encrypt/
 * decrypt flow is real. Everything resets when the process restarts.
 *
 * For production swap these for the Prisma implementations (stores/prisma.ts).
 */

export class MemoryConnectionStore implements ConnectionStore {
  private rows = new Map<string, { blob: Buffer; status: string; externalOwner?: string; expiresAt?: Date }>();
  private k(hostId: string, channel: ChannelKey) {
    return `${hostId}:${channel}`;
  }

  async save(
    hostId: string,
    channel: ChannelKey,
    credentials: Record<string, string>,
    meta: { authType: string; externalOwner?: string; expiresAt?: Date }
  ): Promise<void> {
    this.rows.set(this.k(hostId, channel), {
      blob: encryptJson(credentials),
      status: "active",
      externalOwner: meta.externalOwner,
      expiresAt: meta.expiresAt,
    });
  }

  async get(hostId: string, channel: ChannelKey): Promise<Connection | null> {
    const row = this.rows.get(this.k(hostId, channel));
    if (!row || row.status !== "active") return null;
    return { channel, credentials: decryptJson(row.blob) };
  }

  async setStatus(hostId: string, channel: ChannelKey, status: string): Promise<void> {
    const row = this.rows.get(this.k(hostId, channel));
    if (row) row.status = status;
  }
}

export class MemoryEventStore implements EventStore {
  private events = new Map<string, MasterEvent>();
  private targets = new Map<string, ChannelKey[]>();
  private refs = new Map<string, Map<ChannelKey, PublishResult>>();

  async createMaster(input: Omit<MasterEvent, "id">): Promise<MasterEvent> {
    const event: MasterEvent = { ...input, id: randomUUID() };
    this.events.set(event.id, event);
    return event;
  }
  async getMaster(eventId: string): Promise<MasterEvent | null> {
    return this.events.get(eventId) ?? null;
  }
  async setTargets(eventId: string, channels: ChannelKey[]): Promise<void> {
    this.targets.set(eventId, channels);
  }
  async getEnabledTargets(eventId: string): Promise<ChannelKey[]> {
    return this.targets.get(eventId) ?? [];
  }
  async saveExternalRef(eventId: string, result: PublishResult): Promise<void> {
    if (!this.refs.has(eventId)) this.refs.set(eventId, new Map());
    this.refs.get(eventId)!.set(result.channel, result);
  }
  async getExternalRef(eventId: string, channel: ChannelKey): Promise<ExternalRef | null> {
    return this.refs.get(eventId)?.get(channel)?.ref ?? null;
  }
  async listExternalRefs(eventId: string): Promise<PublishResult[]> {
    return Array.from(this.refs.get(eventId)?.values() ?? []);
  }
}

export class MemoryRegistrationStore implements RegistrationStore {
  // keyed by (channel, externalAttendeeId) for idempotent upsert
  private regs = new Map<string, RawRegistration & { eventId: string }>();

  async upsertRegistration(eventId: string, reg: RawRegistration): Promise<void> {
    this.regs.set(`${reg.channel}:${reg.externalAttendeeId}`, { ...reg, eventId });
  }
  /** Helper for the demo status/attendee views (not part of the port). */
  list(eventId: string): RawRegistration[] {
    return Array.from(this.regs.values()).filter((r) => r.eventId === eventId);
  }
}
