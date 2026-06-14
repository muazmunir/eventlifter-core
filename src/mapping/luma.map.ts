import { MasterEvent, Visibility } from "../types";

/**
 * Master event -> Luma public API payloads.
 *
 * Create is a single call: POST /event/create.
 * Luma is calendar-scoped (the API key belongs to a calendar). Paid ticket
 * types are configured via separate ticket-type endpoints after create; the
 * basic create handles free/RSVP events directly.
 *
 * Verify exact field names against live docs (docs.luma.com) before shipping —
 * Luma's public API is young and fields shift.
 */

const VISIBILITY_MAP: Record<Visibility, string> = {
  public: "public",
  unlisted: "private", // Luma has no "unlisted"; private = link-only, closest match
  private: "private",
  member_only: "member-only",
};

export function lumaCreateBody(m: MasterEvent) {
  const online = m.format === "online";
  return {
    name: m.title,
    start_at: m.startUtc, // ISO 8601
    end_at: m.endUtc,
    timezone: m.timezone,
    cover_url: m.coverImageUrl,
    description_md: m.description,
    visibility: VISIBILITY_MAP[m.visibility],

    // RSVP behaviour
    require_rsvp: true,
    require_rsvp_approval: !!m.requireApproval,

    // location: online vs geo
    meeting_url: online ? m.onlineUrl : undefined,
    geo_latitude: online ? undefined : m.latitude,
    geo_longitude: online ? undefined : m.longitude,
    geo_address_json: online
      ? undefined
      : {
          type: "manual",
          address: m.address,
          city: m.city,
          region: m.region,
          postal_code: m.postalCode,
          country: m.country,
          description: m.venueName,
        },
  };
}

/**
 * Luma tags are free-form. Apply after create via the tag/person endpoints,
 * or pass through if the create endpoint accepts them in your API version.
 */
export function lumaTags(m: MasterEvent): string[] {
  return m.tags ?? [];
}

/**
 * Paid events: after create, define a ticket type.
 * POST /event/create-ticket-type (verify path) with this body.
 */
export function lumaTicketTypeBody(m: MasterEvent) {
  if (m.ticketType === "free") return null;
  return {
    name: m.ticketType === "donation" ? "Donation" : "General Admission",
    // Luma amounts are in cents
    cents: m.ticketType === "donation" ? 0 : m.priceCents,
    currency: m.currency,
    is_free: false,
    require_approval: !!m.requireApproval,
  };
}
