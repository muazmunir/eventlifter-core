import { MasterEvent } from "../types";

/**
 * Master event -> Eventbrite v3 payloads.
 *
 * Eventbrite is NOT a one-shot create. The real sequence is:
 *   1. POST /organizations/{org}/venues/        (if in-person)  -> venue_id
 *   2. POST /organizations/{org}/events/         (draft)         -> event_id, url
 *   3. POST /events/{event_id}/ticket_classes/   (>=1 required)
 *   4. POST /events/{event_id}/publish/                          -> { published: true }
 *
 * These builders produce the request bodies for steps 1–3.
 *
 * NOTE: `category` here is a human label. Eventbrite needs a numeric category_id.
 * Map labels -> IDs via GET /categories/ once and cache. EB_CATEGORY_IDS below is
 * a starter map; verify the IDs against the live /categories/ endpoint.
 */

export const EB_CATEGORY_IDS: Record<string, string> = {
  Music: "103",
  "Food & Drink": "110",
  "Arts & Culture": "105",
  Community: "113",
  Business: "101",
  "Sports & Fitness": "108",
};

export function ebVenueBody(m: MasterEvent) {
  return {
    venue: {
      name: m.venueName ?? m.title,
      address: {
        address_1: m.address ?? "",
        city: m.city ?? "",
        region: m.region ?? "",
        postal_code: m.postalCode ?? "",
        country: m.country ?? "",
      },
      latitude: m.latitude != null ? String(m.latitude) : undefined,
      longitude: m.longitude != null ? String(m.longitude) : undefined,
    },
  };
}

export function ebEventBody(m: MasterEvent, venueId?: string) {
  const online = m.format === "online";
  return {
    event: {
      name: { html: m.title },
      summary: m.summary, // short; EB truncates ~140 chars
      description: { html: m.description ?? "" },
      start: { timezone: m.timezone, utc: toEbUtc(m.startUtc) },
      end: { timezone: m.timezone, utc: toEbUtc(m.endUtc) },
      currency: m.currency,
      online_event: online,
      venue_id: online ? undefined : venueId,
      capacity: m.capacity,
      category_id: m.category ? EB_CATEGORY_IDS[m.category] : undefined,
      // visibility model: EB has no single enum; these three booleans express it.
      listed: m.visibility === "public",
      shareable: m.visibility !== "private",
      invite_only: !!m.inviteOnly,
      password: m.password || undefined,
      show_remaining: !!m.showRemaining,
    },
  };
}

export function ebTicketClassBody(m: MasterEvent) {
  const free = m.ticketType === "free";
  const donation = m.ticketType === "donation";
  return {
    ticket_class: {
      name: free ? "General Admission" : m.ticketType === "donation" ? "Donation" : "General Admission",
      free,
      donation,
      // paid tickets: cost is "CURRENCY,minorunits" e.g. "USD,2500"
      cost: free || donation ? undefined : `${m.currency},${m.priceCents}`,
      quantity_total: m.capacity,
      minimum_quantity: m.minPerOrder,
      maximum_quantity: m.maxPerOrder,
      sales_start: m.salesStartUtc ? toEbUtc(m.salesStartUtc) : undefined,
      sales_end: m.salesEndUtc ? toEbUtc(m.salesEndUtc) : undefined,
      sales_channels: ["online", "atd"],
    },
  };
}

/** Eventbrite expects UTC as "YYYY-MM-DDTHH:MM:SSZ" (no milliseconds). */
function toEbUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}
