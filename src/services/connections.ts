import { ChannelRegistry } from "../channels/adapter";
import { ConnectionStore } from "../ports";
import { ChannelKey } from "../types";

/**
 * ConnectionService — the host-facing connect flows. One per channel auth style:
 *   - Eventbrite: OAuth2 redirect round-trip
 *   - Luma:       paste an API key (validated, then stored)
 *   - HighTribe:  native, nothing to authorize
 *
 * Connections are account-level (per host), not per-event — every event the host
 * publishes reuses them. Credentials are persisted via ConnectionStore, which
 * must encrypt them at rest.
 */
export class ConnectionService {
  constructor(private registry: ChannelRegistry, private store: ConnectionStore) {}

  /** OAuth step 1 — the URL to send the host to. `state` should encode hostId + a CSRF nonce. */
  getAuthUrl(channel: ChannelKey, state: string): string {
    const adapter = this.registry.get(channel);
    if (!adapter.getAuthUrl) throw new Error(`${channel} is not an OAuth channel`);
    return adapter.getAuthUrl(state);
  }

  /** OAuth step 2 — exchange the callback code and store the resulting credentials. */
  async completeOAuth(hostId: string, channel: ChannelKey, code: string): Promise<void> {
    const adapter = this.registry.get(channel);
    if (!adapter.exchangeCode) throw new Error(`${channel} is not an OAuth channel`);
    const credentials = await adapter.exchangeCode(code);
    await this.store.save(hostId, channel, credentials, {
      authType: adapter.authType,
      externalOwner: credentials.organizationId,
    });
  }

  /** API-key channels (Luma): validate the key, then store it. */
  async connectApiKey(
    hostId: string,
    channel: ChannelKey,
    credentials: Record<string, string>
  ): Promise<void> {
    const adapter = this.registry.get(channel);
    if (adapter.authType !== "api_key") throw new Error(`${channel} does not use an API key`);
    const ok = adapter.validateConnection
      ? await adapter.validateConnection({ channel, credentials })
      : true;
    if (!ok) {
      throw new Error(`${channel} rejected the key (invalid, or the account lacks the required paid plan)`);
    }
    await this.store.save(hostId, channel, credentials, {
      authType: adapter.authType,
      externalOwner: credentials.calendarId,
    });
  }

  /** Native channel (HighTribe): no external auth. */
  async connectNative(hostId: string): Promise<void> {
    await this.store.save(hostId, "hightribe", { internalHostId: hostId }, { authType: "native" });
  }

  /** Disconnect — mark revoked. (Keep the row for audit; don't hard-delete.) */
  async disconnect(hostId: string, channel: ChannelKey): Promise<void> {
    await this.store.setStatus(hostId, channel, "revoked");
  }
}
