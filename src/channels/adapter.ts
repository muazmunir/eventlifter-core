import {
  ChannelCapabilities,
  ChannelKey,
  Connection,
  DomainEvent,
  ExternalRef,
  MasterEvent,
  RawRegistration,
} from "../types";

/**
 * Every channel implements this. This is the seam that keeps the core clean:
 * no `if (channel === "x")` branching leaks past the adapter boundary.
 *
 * Methods guarded by a capability (publish/update/pullAttendees…) are only ever
 * called by the orchestrator when that capability is true.
 */
export interface ChannelAdapter {
  readonly key: ChannelKey;
  readonly authType: "native" | "oauth2" | "api_key";
  readonly capabilities: ChannelCapabilities;

  // ── connection lifecycle ──
  /** OAuth channels: build the consent URL the host is redirected to. */
  getAuthUrl?(state: string): string;
  /** OAuth channels: exchange the callback code for stored credentials. */
  exchangeCode?(code: string): Promise<Record<string, string>>;
  /** Confirm a connection's credentials actually work (used on connect + reconnect). */
  validateConnection?(conn: Connection): Promise<boolean>;

  /** Create + publish the event on the channel. Returns the external id + url. */
  publish(master: MasterEvent, conn: Connection): Promise<ExternalRef>;

  /** Push changed fields to an already-published event. */
  update?(ref: ExternalRef, master: MasterEvent, conn: Connection): Promise<void>;

  /** Take the event down. */
  unpublish?(ref: ExternalRef, conn: Connection): Promise<void>;

  /** Pull registrations/attendees. `since` enables incremental sync. */
  fetchAttendees?(ref: ExternalRef, conn: Connection, since?: Date): Promise<RawRegistration[]>;

  /** Verify an inbound webhook's signature. Return false to reject. */
  verifyWebhook?(headers: Record<string, string>, rawBody: string): boolean;

  /** Turn a raw webhook payload into normalized domain events. */
  parseWebhook?(payload: unknown): Promise<DomainEvent[]>;
}

/** Simple registry so the orchestrator can resolve an adapter by key. */
export class ChannelRegistry {
  private adapters = new Map<ChannelKey, ChannelAdapter>();

  register(adapter: ChannelAdapter): this {
    this.adapters.set(adapter.key, adapter);
    return this;
  }

  get(key: ChannelKey): ChannelAdapter {
    const a = this.adapters.get(key);
    if (!a) throw new Error(`No adapter registered for channel "${key}"`);
    return a;
  }

  has(key: ChannelKey): boolean {
    return this.adapters.has(key);
  }
}

/** Small helper used by HTTP-based adapters. Throws on non-2xx with body text. */
export async function httpJson<T = unknown>(
  url: string,
  init: RequestInit & { expect?: "json" | "text" } = {}
): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new ChannelHttpError(res.status, `${init.method ?? "GET"} ${url} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export class ChannelHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ChannelHttpError";
  }
  /** 401/403 mean the connection's token/key is bad → flip connection to "expired", don't blind-retry. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
  /** 429 → back off and retry. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}
