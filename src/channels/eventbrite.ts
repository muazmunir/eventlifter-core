import { ChannelAdapter, httpJson } from "./adapter";
import {
  ChannelCapabilities,
  Connection,
  DomainEvent,
  ExternalRef,
  MasterEvent,
  RawRegistration,
} from "../types";
import { ebEventBody, ebTicketClassBody, ebVenueBody } from "../mapping/eventbrite.map";

const BASE = "https://www.eventbriteapi.com/v3";

/**
 * Eventbrite adapter — full two-way channel.
 * Auth: OAuth2 bearer token (long-lived). Connection.credentials:
 *   { accessToken, organizationId }
 * Rate limits: 1000 calls/hour, 48000/day per token (back off on 429).
 */
export class EventbriteAdapter implements ChannelAdapter {
  readonly key = "eventbrite" as const;
  readonly authType = "oauth2" as const;
  readonly capabilities: ChannelCapabilities = {
    publish: true,
    update: true,
    unpublish: true,
    pullAttendees: true,
    webhooks: true,
    pricing: true,
    capacitySync: true,
  };

  constructor(
    private oauth?: { clientId: string; clientSecret: string; redirectUri: string }
  ) {}

  // ── connection lifecycle ──
  getAuthUrl(state: string): string {
    if (!this.oauth) throw new Error("Eventbrite OAuth config not provided");
    const q = new URLSearchParams({
      response_type: "code",
      client_id: this.oauth.clientId,
      redirect_uri: this.oauth.redirectUri,
      state,
    });
    return `https://www.eventbrite.com/oauth/authorize?${q}`;
  }

  /** Exchange the callback code for a token, then resolve the org id we publish under. */
  async exchangeCode(code: string): Promise<Record<string, string>> {
    if (!this.oauth) throw new Error("Eventbrite OAuth config not provided");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.oauth.clientId,
      client_secret: this.oauth.clientSecret,
      redirect_uri: this.oauth.redirectUri,
    });
    const tok = await httpJson<{ access_token: string }>(`https://www.eventbrite.com/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const orgs = await httpJson<{ organizations: Array<{ id: string }> }>(
      `${BASE}/users/me/organizations/`,
      { headers: { Authorization: `Bearer ${tok.access_token}` } }
    );
    const organizationId = orgs.organizations?.[0]?.id;
    if (!organizationId) throw new Error("Eventbrite: no organization found for this account");
    return { accessToken: tok.access_token, organizationId };
  }

  async validateConnection(conn: Connection): Promise<boolean> {
    try {
      await httpJson(`${BASE}/users/me/`, {
        headers: { Authorization: `Bearer ${conn.credentials.accessToken}` },
      });
      return true;
    } catch {
      return false;
    }
  }

  private auth(conn: Connection) {
    const token = conn.credentials.accessToken;
    const org = conn.credentials.organizationId;
    if (!token || !org) throw new Error("Eventbrite connection missing accessToken/organizationId");
    return { token, org, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
  }

  async publish(master: MasterEvent, conn: Connection): Promise<ExternalRef> {
    const { org, headers } = this.auth(conn);

    // 1. venue (in-person only)
    let venueId: string | undefined;
    if (master.format !== "online") {
      const venue = await httpJson<{ id: string }>(`${BASE}/organizations/${org}/venues/`, {
        method: "POST",
        headers,
        body: JSON.stringify(ebVenueBody(master)),
      });
      venueId = venue.id;
    }

    // 2. draft event
    const event = await httpJson<{ id: string; url: string }>(`${BASE}/organizations/${org}/events/`, {
      method: "POST",
      headers,
      body: JSON.stringify(ebEventBody(master, venueId)),
    });

    // 3. ticket class (Eventbrite refuses to publish without >=1)
    await httpJson(`${BASE}/events/${event.id}/ticket_classes/`, {
      method: "POST",
      headers,
      body: JSON.stringify(ebTicketClassBody(master)),
    });

    // 4. publish
    await httpJson(`${BASE}/events/${event.id}/publish/`, { method: "POST", headers });

    return { channel: this.key, externalEventId: event.id, externalEventUrl: event.url };
  }

  async update(ref: ExternalRef, master: MasterEvent, conn: Connection): Promise<void> {
    const { headers } = this.auth(conn);
    await httpJson(`${BASE}/events/${ref.externalEventId}/`, {
      method: "POST",
      headers,
      body: JSON.stringify(ebEventBody(master)),
    });
  }

  async unpublish(ref: ExternalRef, conn: Connection): Promise<void> {
    const { headers } = this.auth(conn);
    await httpJson(`${BASE}/events/${ref.externalEventId}/unpublish/`, { method: "POST", headers });
  }

  async fetchAttendees(ref: ExternalRef, conn: Connection, since?: Date): Promise<RawRegistration[]> {
    const { headers } = this.auth(conn);
    const out: RawRegistration[] = [];
    let continuation: string | undefined;
    const sinceParam = since ? `&changed_since=${since.toISOString()}` : "";

    do {
      const page = continuation ? `&continuation=${continuation}` : "";
      const data = await httpJson<EbAttendeePage>(
        `${BASE}/events/${ref.externalEventId}/attendees/?expand=order${sinceParam}${page}`,
        { headers }
      );
      for (const a of data.attendees ?? []) out.push(mapEbAttendee(a));
      continuation = data.pagination?.has_more_items ? data.pagination.continuation : undefined;
    } while (continuation);

    return out;
  }

  /**
   * Eventbrite webhooks send a REFERENCE, not the object:
   *   { api_url: "...orders/123/", config: { action: "order.placed" } }
   * Fetch api_url with the host token to get the full record. Here we surface the
   * api_url + action; the worker fetches and re-maps (it holds the connection).
   */
  async parseWebhook(payload: unknown): Promise<DomainEvent[]> {
    const p = payload as { api_url?: string; config?: { action?: string } };
    const action = p.config?.action;
    if (!action || !p.api_url) return [];
    if (action === "event.updated") {
      return [{ type: "event.updated", channel: this.key, externalEventId: extractEventId(p.api_url) }];
    }
    if (action === "order.placed" || action === "attendee.updated") {
      // worker should GET p.api_url, then mapEbAttendee() the result.
      return [
        {
          type: "registration.upsert",
          registration: {
            channel: this.key,
            externalAttendeeId: extractTrailingId(p.api_url),
            status: "registered",
            raw: { fetch: p.api_url, action },
          },
        },
      ];
    }
    return [];
  }
}

interface EbAttendeePage {
  attendees?: EbAttendee[];
  pagination?: { has_more_items: boolean; continuation?: string };
}
interface EbAttendee {
  id: string;
  profile?: { name?: string; email?: string; cell_phone?: string };
  ticket_class_name?: string;
  costs?: { gross?: { value?: number; currency?: string } };
  cancelled?: boolean;
  refunded?: boolean;
  checked_in?: boolean;
  created?: string;
}

function mapEbAttendee(a: EbAttendee): RawRegistration {
  return {
    channel: "eventbrite",
    externalAttendeeId: a.id,
    name: a.profile?.name,
    email: a.profile?.email,
    phone: a.profile?.cell_phone,
    ticketType: a.ticket_class_name,
    amountCents: a.costs?.gross?.value,
    currency: a.costs?.gross?.currency,
    status: a.refunded ? "refunded" : a.cancelled ? "cancelled" : a.checked_in ? "attended" : "registered",
    checkedIn: !!a.checked_in,
    sourceCreatedAt: a.created,
    raw: a,
  };
}

function extractTrailingId(apiUrl: string): string {
  const m = apiUrl.match(/\/(\d+)\/?$/);
  return m ? m[1] : apiUrl;
}
function extractEventId(apiUrl: string): string {
  const m = apiUrl.match(/events\/(\d+)/);
  return m ? m[1] : extractTrailingId(apiUrl);
}
