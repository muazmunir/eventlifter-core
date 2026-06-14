/**
 * EventLifter — core domain types.
 * The MasterEvent is the source of truth. Adapters map it into each channel's shape.
 */

export type ChannelKey = "hightribe" | "eventbrite" | "luma";

export type TicketType = "free" | "paid" | "donation";
export type EventFormat = "in_person" | "online" | "hybrid";
export type Visibility = "public" | "unlisted" | "private" | "member_only";

/** The single source of truth. All money is integer minor units (cents). */
export interface MasterEvent {
  id: string;
  hostId: string;

  // basics
  title: string;
  summary?: string;
  description?: string;
  coverImageUrl?: string;
  category?: string; // human label; adapters map to channel-specific IDs
  tags: string[];

  // when (always store/transport UTC ISO + IANA tz)
  startUtc: string; // e.g. "2026-07-18T00:30:00Z"
  endUtc: string;
  timezone: string; // IANA, e.g. "America/Los_Angeles"

  // where
  format: EventFormat;
  venueName?: string;
  address?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string; // ISO-3166 alpha-2
  latitude?: number;
  longitude?: number;
  onlineUrl?: string; // for online / hybrid

  // tickets
  ticketType: TicketType;
  priceCents: number;
  currency: string; // ISO-4217, e.g. "USD"
  capacity?: number;
  minPerOrder?: number;
  maxPerOrder?: number;
  salesStartUtc?: string;
  salesEndUtc?: string;
  waitlist?: boolean;

  // access
  visibility: Visibility;
  requireApproval?: boolean;
  inviteOnly?: boolean;
  password?: string;
  showRemaining?: boolean;

  // host / policy
  hostName?: string;
  refundPolicy?: string;
  faq?: string;
}

/** What a single channel can do. The orchestrator and dashboard branch on this. */
export interface ChannelCapabilities {
  publish: boolean;
  update: boolean;
  unpublish: boolean;
  pullAttendees: boolean;
  webhooks: boolean;
  pricing: boolean;
  capacitySync: boolean;
}

/** Decrypted credentials for one host↔channel connection (stored encrypted at rest). */
export interface Connection {
  channel: ChannelKey;
  // eventbrite: { accessToken, organizationId }
  // luma:       { apiKey, calendarId? }
  // hightribe:  { internalHostId }
  credentials: Record<string, string>;
}

/** Returned by a channel after a successful publish. */
export interface ExternalRef {
  channel: ChannelKey;
  externalEventId: string;
  externalEventUrl: string;
}

/** A normalized attendee/registration, channel-agnostic. */
export interface RawRegistration {
  channel: ChannelKey;
  externalAttendeeId: string;
  name?: string;
  email?: string;
  phone?: string;
  ticketType?: string;
  amountCents?: number;
  currency?: string;
  status: "registered" | "waitlisted" | "cancelled" | "refunded" | "attended" | "no_show";
  checkedIn?: boolean;
  sourceCreatedAt?: string;
  raw: unknown;
}

/** A normalized inbound event from a webhook. */
export type DomainEvent =
  | { type: "registration.upsert"; registration: RawRegistration }
  | { type: "event.updated"; channel: ChannelKey; externalEventId: string }
  | { type: "event.cancelled"; channel: ChannelKey; externalEventId: string };

export type SyncStatus = "pending" | "syncing" | "synced" | "partial" | "failed" | "manual";

/** Per-channel result of a publish attempt. */
export interface PublishResult {
  channel: ChannelKey;
  status: SyncStatus;
  ref?: ExternalRef;
  error?: string;
}
