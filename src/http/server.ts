import express, { Request, Response } from "express";
import { ChannelRegistry } from "../channels/adapter";
import { EventbriteAdapter } from "../channels/eventbrite";
import { LumaAdapter } from "../channels/luma";
import { HighTribeAdapter, HighTribeClient } from "../channels/hightribe";
import { PublishOrchestrator, rollupStatus } from "../services/publish";
import { ConnectionService } from "../services/connections";
import { WebhookRouter } from "../services/webhooks";
import { MemoryConnectionStore, MemoryEventStore, MemoryRegistrationStore } from "../stores/memory";
import { ConnectionStore, EventStore, RegistrationStore } from "../ports";
import { ChannelKey, Connection, MasterEvent } from "../types";

const CHANNELS: ChannelKey[] = ["hightribe", "eventbrite", "luma"];
const isChannel = (s: string): s is ChannelKey => (CHANNELS as string[]).includes(s);

/**
 * Local HighTribe stand-in. Replace with a real HighTribeClient that calls your
 * event service. Here it just mints ids so the native channel "works" offline.
 */
const fakeHighTribe: HighTribeClient = {
  async createEvent(_hostId, m) {
    return { id: `ht_${Date.now()}`, url: `https://hightribe.co/e/${m.id}` };
  },
  async updateEvent() {},
  async cancelEvent() {},
  async listRegistrations() {
    return [];
  },
};

function buildRegistry(): ChannelRegistry {
  const eb = process.env.EVENTBRITE_CLIENT_ID
    ? new EventbriteAdapter({
        clientId: process.env.EVENTBRITE_CLIENT_ID!,
        clientSecret: process.env.EVENTBRITE_CLIENT_SECRET!,
        redirectUri: process.env.EVENTBRITE_REDIRECT_URI!,
      })
    : new EventbriteAdapter();
  return new ChannelRegistry()
    .register(new HighTribeAdapter(fakeHighTribe))
    .register(eb)
    .register(new LumaAdapter());
}

const MASTER_DEFAULTS: Omit<MasterEvent, "id" | "hostId" | "title"> = {
  tags: [],
  startUtc: new Date(Date.now() + 7 * 864e5).toISOString(),
  endUtc: new Date(Date.now() + 7 * 864e5 + 3 * 36e5).toISOString(),
  timezone: "America/Los_Angeles",
  format: "in_person",
  ticketType: "free",
  priceCents: 0,
  currency: "USD",
  visibility: "public",
};

export function buildApp(deps: {
  registry: ChannelRegistry;
  connections: ConnectionStore;
  events: EventStore;
  registrations: RegistrationStore;
}) {
  const orchestrator = new PublishOrchestrator(deps.registry);
  const connService = new ConnectionService(deps.registry, deps.connections);
  const webhookRouter = new WebhookRouter(deps.registry);
  const app = express();
  app.use(express.json());

  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) =>
    fn(req, res).catch((e: Error) => res.status(400).json({ error: e.message }));

  app.get("/", (_req, res) => {
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>EventLifter API</title>
<style>body{font-family:monospace;background:#0f0f0f;color:#e0e0e0;padding:40px;max-width:720px;margin:auto}
h1{color:#7ee787;margin-bottom:4px}p{color:#8b949e;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-top:24px}
th{text-align:left;color:#58a6ff;border-bottom:1px solid #30363d;padding:8px 12px}
td{padding:8px 12px;border-bottom:1px solid #21262d;vertical-align:top}
.method{color:#f0883e;font-weight:bold}.path{color:#79c0ff}
a{color:#79c0ff;text-decoration:none}a:hover{text-decoration:underline}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;background:#1f6feb22;border:1px solid #1f6feb;color:#58a6ff}
</style></head><body>
<h1>EventLifter Core</h1>
<p>Channel adapter for HighTribe, Eventbrite &amp; Luma &mdash; in-memory mode</p>
<span class="badge">running</span>
<table>
<tr><th>Method</th><th>Path</th><th>Purpose</th></tr>
<tr><td class="method">GET</td><td class="path"><a href="/health">/health</a></td><td>Liveness + channel list</td></tr>
<tr><td class="method">GET</td><td class="path">/connections/:channel/start?hostId=</td><td>OAuth consent URL (Eventbrite)</td></tr>
<tr><td class="method">GET</td><td class="path">/connections/eventbrite/callback</td><td>OAuth callback</td></tr>
<tr><td class="method">POST</td><td class="path">/connections/:channel</td><td>API-key / native connect</td></tr>
<tr><td class="method">DELETE</td><td class="path">/connections/:channel?hostId=</td><td>Disconnect channel</td></tr>
<tr><td class="method">POST</td><td class="path">/events</td><td>Create a master event</td></tr>
<tr><td class="method">POST</td><td class="path">/events/:id/publish</td><td>Publish to enabled channels</td></tr>
<tr><td class="method">GET</td><td class="path">/events/:id/status</td><td>Per-channel sync state</td></tr>
<tr><td class="method">POST</td><td class="path">/webhooks/:channel?eventId=</td><td>Inbound webhook handler</td></tr>
</table>
</body></html>`);
  });

  app.get("/health", (_req, res) => res.json({ ok: true, channels: CHANNELS }));

  // ── connections ──────────────────────────────────────────
  // OAuth start (Eventbrite): GET /connections/eventbrite/start?hostId=...
  app.get(
    "/connections/:channel/start",
    wrap(async (req, res) => {
      const { channel } = req.params;
      if (!isChannel(channel)) return res.status(404).json({ error: "unknown channel" });
      const hostId = String(req.query.hostId ?? "");
      // state encodes the host so the callback knows who connected (add a CSRF nonce in prod)
      const url = connService.getAuthUrl(channel, hostId);
      return res.json({ url });
    })
  );

  // OAuth callback (Eventbrite): the redirect_uri lands here with ?code & ?state
  app.get(
    "/connections/eventbrite/callback",
    wrap(async (req, res) => {
      const code = String(req.query.code ?? "");
      const hostId = String(req.query.state ?? "");
      await connService.completeOAuth(hostId, "eventbrite", code);
      return res.json({ connected: true, channel: "eventbrite" });
    })
  );

  // API-key / native connect: POST /connections/luma { hostId, credentials:{apiKey} }
  app.post(
    "/connections/:channel",
    wrap(async (req, res) => {
      const { channel } = req.params;
      if (!isChannel(channel)) return res.status(404).json({ error: "unknown channel" });
      const { hostId, credentials } = req.body ?? {};
      if (!hostId) return res.status(400).json({ error: "hostId required" });
      if (channel === "hightribe") await connService.connectNative(hostId);
      else await connService.connectApiKey(hostId, channel, credentials ?? {});
      return res.json({ connected: true, channel });
    })
  );

  app.delete(
    "/connections/:channel",
    wrap(async (req, res) => {
      const { channel } = req.params;
      if (!isChannel(channel)) return res.status(404).json({ error: "unknown channel" });
      await connService.disconnect(String(req.query.hostId ?? ""), channel);
      return res.json({ disconnected: true, channel });
    })
  );

  // ── events ───────────────────────────────────────────────
  // POST /events  { hostId, title, ...fields, targets?:[] }
  app.post(
    "/events",
    wrap(async (req, res) => {
      const { hostId, title, targets, ...rest } = req.body ?? {};
      if (!hostId || !title) return res.status(400).json({ error: "hostId and title required" });
      const master = await deps.events.createMaster({ ...MASTER_DEFAULTS, ...rest, hostId, title } as Omit<MasterEvent, "id">);
      const chosen: ChannelKey[] = Array.isArray(targets) && targets.length ? targets.filter(isChannel) : CHANNELS;
      await deps.events.setTargets(master.id, chosen);
      return res.json({ id: master.id, targets: chosen });
    })
  );

  // POST /events/:id/publish  → publishes inline, returns per-channel results
  app.post(
    "/events/:id/publish",
    wrap(async (req, res) => {
      const master = await deps.events.getMaster(req.params.id);
      if (!master) return res.status(404).json({ error: "event not found" });
      const targets = await deps.events.getEnabledTargets(master.id);

      const connections: Partial<Record<ChannelKey, Connection>> = {};
      for (const ch of targets) connections[ch] = (await deps.connections.get(master.hostId, ch)) ?? undefined;

      const results = await orchestrator.publish(master, targets, connections);
      for (const r of results) await deps.events.saveExternalRef(master.id, r);
      return res.json({ event: master.id, rollup: rollupStatus(results), results });
    })
  );

  // GET /events/:id/status → current per-channel sync state
  app.get(
    "/events/:id/status",
    wrap(async (req, res) => {
      const refs = await deps.events.listExternalRefs(req.params.id);
      return res.json({ event: req.params.id, channels: refs });
    })
  );

  // ── webhooks ─────────────────────────────────────────────
  // POST /webhooks/:channel?eventId=...  (prod resolves eventId from the external map)
  app.post(
    "/webhooks/:channel",
    wrap(async (req, res) => {
      const { channel } = req.params;
      if (!isChannel(channel)) return res.status(404).json({ error: "unknown channel" });
      const raw = JSON.stringify(req.body ?? {});
      if (!webhookRouter.verify(channel, req.headers as Record<string, string>, raw)) {
        return res.status(401).json({ error: "signature verification failed" });
      }
      const eventsOut = await webhookRouter.parse(channel, req.body);
      const eventId = req.query.eventId ? String(req.query.eventId) : undefined;
      if (eventId) {
        for (const e of eventsOut) {
          if (e.type === "registration.upsert") await deps.registrations.upsertRegistration(eventId, e.registration);
        }
      }
      return res.json({ received: eventsOut.length, events: eventsOut });
    })
  );

  return app;
}

if (require.main === module) {
  const app = buildApp({
    registry: buildRegistry(),
    connections: new MemoryConnectionStore(),
    events: new MemoryEventStore(),
    registrations: new MemoryRegistrationStore(),
  });
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    console.log(`EventLifter API on http://localhost:${port}  (in-memory mode — no DB/Redis needed)`);
    console.log(`Try:  curl localhost:${port}/health`);
  });
}
