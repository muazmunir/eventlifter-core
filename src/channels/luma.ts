import { ChannelAdapter, httpJson } from "./adapter";
import {
  ChannelCapabilities,
  Connection,
  DomainEvent,
  ExternalRef,
  MasterEvent,
  RawRegistration,
} from "../types";
import { lumaCreateBody, lumaTicketTypeBody } from "../mapping/luma.map";

// Luma's public API base. Some docs reference https://api.lu.ma/public/v1 — verify
// which your key targets; the header is the same.
const BASE = "https://public-api.luma.com/v1";

/**
 * Luma adapter — full two-way channel, but gated behind a paid "Luma Plus" plan
 * on the host's side (the API key won't work otherwise).
 * Auth: API key in `x-luma-api-key` header. Connection.credentials:
 *   { apiKey, calendarId? }
 * Rate limit: 200 req/min per calendar key.
 */
export class LumaAdapter implements ChannelAdapter {
  readonly key = "luma" as const;
  readonly authType = "api_key" as const;
  readonly capabilities: ChannelCapabilities = {
    publish: true,
    update: true,
    unpublish: false, // Luma deletes/cancels; no clean "unpublish"
    pullAttendees: true,
    webhooks: true,
    pricing: true,
    capacitySync: false,
  };

  private headers(conn: Connection) {
    const apiKey = conn.credentials.apiKey;
    if (!apiKey) throw new Error("Luma connection missing apiKey");
    return { "x-luma-api-key": apiKey, "Content-Type": "application/json" };
  }

  /** Validate the key by hitting a cheap read endpoint. 401 = bad key or no Luma Plus. */
  async validateConnection(conn: Connection): Promise<boolean> {
    try {
      await httpJson(`${BASE}/calendar/list-events`, { headers: this.headers(conn) });
      return true;
    } catch {
      return false;
    }
  }

  async publish(master: MasterEvent, conn: Connection): Promise<ExternalRef> {
    const headers = this.headers(conn);

    const created = await httpJson<{ api_id: string; url?: string }>(`${BASE}/event/create`, {
      method: "POST",
      headers,
      body: JSON.stringify(lumaCreateBody(master)),
    });

    // paid/donation events: attach a ticket type after create
    const ticket = lumaTicketTypeBody(master);
    if (ticket) {
      await httpJson(`${BASE}/event/create-ticket-type`, {
        method: "POST",
        headers,
        body: JSON.stringify({ event_api_id: created.api_id, ...ticket }),
      }).catch(() => {
        /* non-fatal: event is live as free/RSVP; surface as a warning upstream */
      });
    }

    return {
      channel: this.key,
      externalEventId: created.api_id,
      externalEventUrl: created.url ?? `https://lu.ma/${created.api_id}`,
    };
  }

  async update(ref: ExternalRef, master: MasterEvent, conn: Connection): Promise<void> {
    await httpJson(`${BASE}/event/update`, {
      method: "POST",
      headers: this.headers(conn),
      body: JSON.stringify({ event_api_id: ref.externalEventId, ...lumaCreateBody(master) }),
    });
  }

  async fetchAttendees(ref: ExternalRef, conn: Connection): Promise<RawRegistration[]> {
    const headers = this.headers(conn);
    const out: RawRegistration[] = [];
    let cursor: string | undefined;

    do {
      const q = new URLSearchParams({ event_api_id: ref.externalEventId });
      if (cursor) q.set("pagination_cursor", cursor);
      const data = await httpJson<LumaGuestPage>(`${BASE}/event/get-guests?${q}`, { headers });
      for (const g of data.entries ?? []) out.push(mapLumaGuest(g.guest ?? g));
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    return out;
  }

  async parseWebhook(payload: unknown): Promise<DomainEvent[]> {
    // Luma posts the guest object inline (event type + data).
    const p = payload as { type?: string; data?: LumaGuest };
    if (!p.type || !p.data) return [];
    if (p.type.startsWith("guest")) {
      return [{ type: "registration.upsert", registration: mapLumaGuest(p.data) }];
    }
    return [];
  }
}

interface LumaGuestPage {
  entries?: Array<{ guest?: LumaGuest } & LumaGuest>;
  has_more?: boolean;
  next_cursor?: string;
}
interface LumaGuest {
  api_id?: string;
  name?: string;
  email?: string;
  phone_number?: string;
  approval_status?: string; // "approved" | "pending" | "declined" | "waitlist"
  checked_in_at?: string | null;
  registered_at?: string;
}

function mapLumaGuest(g: LumaGuest): RawRegistration {
  const status =
    g.approval_status === "waitlist"
      ? "waitlisted"
      : g.approval_status === "declined"
      ? "cancelled"
      : g.checked_in_at
      ? "attended"
      : "registered";
  return {
    channel: "luma",
    externalAttendeeId: g.api_id ?? g.email ?? "",
    name: g.name,
    email: g.email,
    phone: g.phone_number,
    status,
    checkedIn: !!g.checked_in_at,
    sourceCreatedAt: g.registered_at,
    raw: g,
  };
}
