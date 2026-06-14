import { ConnectionStore, EventStore, RegistrationStore } from "../ports";
import { ChannelKey, Connection, ExternalRef, MasterEvent, PublishResult, RawRegistration } from "../types";
import { decryptJson, encryptJson } from "../crypto";

/**
 * Prisma-backed stores (production).
 *
 * NOTE: the `db` param is typed loosely (`PrismaLike`) so this file compiles
 * before you run `prisma generate`. After generating the client, change the
 * constructor types to `PrismaClient` from "@prisma/client" for full type safety.
 *
 * Usage:
 *   import { PrismaClient } from "@prisma/client";
 *   const db = new PrismaClient();
 *   const connections = new PrismaConnectionStore(db);
 */
type PrismaLike = any; // replace with PrismaClient after `prisma generate`

export class PrismaConnectionStore implements ConnectionStore {
  constructor(private db: PrismaLike) {}

  async save(
    hostId: string,
    channel: ChannelKey,
    credentials: Record<string, string>,
    meta: { authType: string; externalOwner?: string; expiresAt?: Date }
  ): Promise<void> {
    const blob = encryptJson(credentials);
    await this.db.channelConnection.upsert({
      where: { hostId_channel: { hostId, channel } },
      create: {
        hostId,
        channel,
        authType: meta.authType,
        credentials: blob,
        externalOwner: meta.externalOwner,
        expiresAt: meta.expiresAt,
        status: "active",
      },
      update: {
        credentials: blob,
        externalOwner: meta.externalOwner,
        expiresAt: meta.expiresAt,
        status: "active",
        lastError: null,
      },
    });
  }

  async get(hostId: string, channel: ChannelKey): Promise<Connection | null> {
    const row = await this.db.channelConnection.findUnique({
      where: { hostId_channel: { hostId, channel } },
    });
    if (!row || row.status !== "active") return null;
    return { channel, credentials: decryptJson(Buffer.from(row.credentials)) };
  }

  async setStatus(hostId: string, channel: ChannelKey, status: string, error?: string): Promise<void> {
    await this.db.channelConnection.update({
      where: { hostId_channel: { hostId, channel } },
      data: { status, lastError: error ?? null },
    });
  }
}

export class PrismaEventStore implements EventStore {
  constructor(private db: PrismaLike) {}

  async createMaster(input: Omit<MasterEvent, "id">): Promise<MasterEvent> {
    const row = await this.db.masterEvent.create({ data: toRow(input) });
    return fromRow(row);
  }
  async getMaster(eventId: string): Promise<MasterEvent | null> {
    const row = await this.db.masterEvent.findUnique({ where: { id: eventId } });
    return row ? fromRow(row) : null;
  }
  async setTargets(eventId: string, channels: ChannelKey[]): Promise<void> {
    await Promise.all(
      channels.map((channel) =>
        this.db.eventChannelTarget.upsert({
          where: { eventId_channel: { eventId, channel } },
          create: { eventId, channel, enabled: true },
          update: { enabled: true },
        })
      )
    );
  }
  async getEnabledTargets(eventId: string): Promise<ChannelKey[]> {
    const rows = await this.db.eventChannelTarget.findMany({ where: { eventId, enabled: true } });
    return rows.map((r: any) => r.channel);
  }
  async saveExternalRef(eventId: string, result: PublishResult): Promise<void> {
    await this.db.externalEventMap.upsert({
      where: { eventId_channel: { eventId, channel: result.channel } },
      create: {
        eventId,
        channel: result.channel,
        externalEventId: result.ref?.externalEventId,
        externalEventUrl: result.ref?.externalEventUrl,
        syncStatus: result.status,
        capabilities: {},
        lastError: result.error,
        lastSyncedAt: result.status === "synced" ? new Date() : undefined,
      },
      update: {
        externalEventId: result.ref?.externalEventId,
        externalEventUrl: result.ref?.externalEventUrl,
        syncStatus: result.status,
        lastError: result.error,
        lastSyncedAt: result.status === "synced" ? new Date() : undefined,
      },
    });
  }
  async getExternalRef(eventId: string, channel: ChannelKey): Promise<ExternalRef | null> {
    const row = await this.db.externalEventMap.findUnique({
      where: { eventId_channel: { eventId, channel } },
    });
    if (!row?.externalEventId) return null;
    return { channel, externalEventId: row.externalEventId, externalEventUrl: row.externalEventUrl ?? "" };
  }
  async listExternalRefs(eventId: string): Promise<PublishResult[]> {
    const rows = await this.db.externalEventMap.findMany({ where: { eventId } });
    return rows.map((r: any) => ({
      channel: r.channel,
      status: r.syncStatus,
      error: r.lastError ?? undefined,
      ref: r.externalEventId
        ? { channel: r.channel, externalEventId: r.externalEventId, externalEventUrl: r.externalEventUrl ?? "" }
        : undefined,
    }));
  }
}

export class PrismaRegistrationStore implements RegistrationStore {
  constructor(private db: PrismaLike) {}

  async upsertRegistration(eventId: string, reg: RawRegistration): Promise<void> {
    await this.db.registration.upsert({
      where: { channel_externalAttendeeId: { channel: reg.channel, externalAttendeeId: reg.externalAttendeeId } },
      create: {
        eventId,
        channel: reg.channel,
        externalAttendeeId: reg.externalAttendeeId,
        name: reg.name,
        email: reg.email,
        phone: reg.phone,
        ticketType: reg.ticketType,
        amountCents: reg.amountCents ?? 0,
        currency: reg.currency,
        status: reg.status,
        checkinStatus: !!reg.checkedIn,
        raw: reg.raw as object,
        sourceCreatedAt: reg.sourceCreatedAt ? new Date(reg.sourceCreatedAt) : undefined,
      },
      update: {
        status: reg.status,
        checkinStatus: !!reg.checkedIn,
        raw: reg.raw as object,
      },
    });
  }
}

/* MasterEvent <-> Prisma row mapping (column names differ slightly). */
function toRow(m: Omit<MasterEvent, "id">) {
  return {
    hostId: m.hostId,
    title: m.title,
    summary: m.summary,
    description: m.description,
    coverImage: m.coverImageUrl,
    startTime: new Date(m.startUtc),
    endTime: new Date(m.endUtc),
    timezone: m.timezone,
    format: m.format,
    venueName: m.venueName,
    address: m.address,
    city: m.city,
    region: m.region,
    postalCode: m.postalCode,
    country: m.country,
    latitude: m.latitude,
    longitude: m.longitude,
    capacity: m.capacity,
    ticketType: m.ticketType,
    priceCents: m.priceCents,
    currency: m.currency,
    refundPolicy: m.refundPolicy,
    faq: m.faq ? { text: m.faq } : undefined,
    tags: m.tags,
    visibility: m.visibility,
  };
}

function fromRow(r: any): MasterEvent {
  return {
    id: r.id,
    hostId: r.hostId,
    title: r.title,
    summary: r.summary ?? undefined,
    description: r.description ?? undefined,
    coverImageUrl: r.coverImage ?? undefined,
    category: undefined,
    tags: r.tags ?? [],
    startUtc: new Date(r.startTime).toISOString(),
    endUtc: new Date(r.endTime).toISOString(),
    timezone: r.timezone,
    format: r.format,
    venueName: r.venueName ?? undefined,
    address: r.address ?? undefined,
    city: r.city ?? undefined,
    region: r.region ?? undefined,
    postalCode: r.postalCode ?? undefined,
    country: r.country ?? undefined,
    latitude: r.latitude != null ? Number(r.latitude) : undefined,
    longitude: r.longitude != null ? Number(r.longitude) : undefined,
    ticketType: r.ticketType,
    priceCents: r.priceCents,
    currency: r.currency,
    capacity: r.capacity ?? undefined,
    visibility: r.visibility,
    refundPolicy: r.refundPolicy ?? undefined,
  };
}
