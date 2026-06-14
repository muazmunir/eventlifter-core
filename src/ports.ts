import { ChannelKey, Connection, ExternalRef, MasterEvent, PublishResult, RawRegistration } from "./types";

/**
 * Ports: the storage contracts the services depend on. Implement these against
 * Prisma (see prisma/schema.prisma) at the edge. Keeping them as interfaces means
 * the adapters, orchestrator, and workers stay pure and testable.
 */

export interface ConnectionStore {
  /** Persist a connection's credentials (envelope-encrypt the blob before write). */
  save(
    hostId: string,
    channel: ChannelKey,
    credentials: Record<string, string>,
    meta: { authType: string; externalOwner?: string; expiresAt?: Date }
  ): Promise<void>;

  get(hostId: string, channel: ChannelKey): Promise<Connection | null>;

  setStatus(hostId: string, channel: ChannelKey, status: "active" | "expired" | "revoked" | "error", error?: string): Promise<void>;
}

export interface EventStore {
  createMaster(input: Omit<MasterEvent, "id">): Promise<MasterEvent>;
  getMaster(eventId: string): Promise<MasterEvent | null>;
  setTargets(eventId: string, channels: ChannelKey[]): Promise<void>;
  getEnabledTargets(eventId: string): Promise<ChannelKey[]>;
  saveExternalRef(eventId: string, result: PublishResult): Promise<void>;
  getExternalRef(eventId: string, channel: ChannelKey): Promise<ExternalRef | null>;
  /** All per-channel publish results for an event (for the status endpoint). */
  listExternalRefs(eventId: string): Promise<PublishResult[]>;
}

export interface RegistrationStore {
  /** Idempotent upsert keyed on (channel, externalAttendeeId). attendeeId left null. */
  upsertRegistration(eventId: string, reg: RawRegistration): Promise<void>;
}
