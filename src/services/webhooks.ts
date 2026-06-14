import { ChannelRegistry } from "../channels/adapter";
import { ChannelKey, DomainEvent, RawRegistration } from "../types";

/**
 * Inbound webhook handling.
 *
 * The HTTP endpoint should do the minimum: verify signature -> persist raw ->
 * enqueue -> return 200 fast. This router turns a raw payload into normalized
 * DomainEvents. Idempotency is enforced upstream by UNIQUE(channel, external_id)
 * on the webhook_events table and UNIQUE(channel, external_attendee_id) on
 * registrations.
 */
export class WebhookRouter {
  constructor(private registry: ChannelRegistry) {}

  verify(channel: ChannelKey, headers: Record<string, string>, rawBody: string): boolean {
    const adapter = this.registry.get(channel);
    return adapter.verifyWebhook ? adapter.verifyWebhook(headers, rawBody) : true;
  }

  async parse(channel: ChannelKey, payload: unknown): Promise<DomainEvent[]> {
    const adapter = this.registry.get(channel);
    return adapter.parseWebhook ? adapter.parseWebhook(payload) : [];
  }
}

/**
 * Dedupe is two-stage and deliberately separated from ingest.
 *
 * Stage 1 (ingest): write the raw registration with attendee_id = null. Dumb,
 * idempotent. (Done by the upsert against registrations.)
 *
 * Stage 2 (match): compute a deterministic key. STRONG match (email or phone)
 * -> auto-merge to an attendee row. WEAK match (name only) -> never auto-merge;
 * create a candidate for host review. Fusing two "John Smith"s automatically
 * corrupts the unified list, so name similarity is a suggestion, not an action.
 */
export function dedupeKey(reg: RawRegistration): string | null {
  if (reg.email) return reg.email.trim().toLowerCase();
  if (reg.phone) return normalizePhone(reg.phone);
  return null; // no strong identifier -> weak-match candidate, host confirms
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}
