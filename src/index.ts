import { ChannelRegistry } from "./channels/adapter";
import { EventbriteAdapter } from "./channels/eventbrite";
import { LumaAdapter } from "./channels/luma";
import { HighTribeAdapter, HighTribeClient } from "./channels/hightribe";
import { PublishOrchestrator, rollupStatus } from "./services/publish";
import { ebEventBody, ebTicketClassBody } from "./mapping/eventbrite.map";
import { lumaCreateBody } from "./mapping/luma.map";
import { Connection, MasterEvent } from "./types";

/**
 * Wire the registry once at boot. Add a channel = register one adapter.
 */
export function buildRegistry(hightribe: HighTribeClient): ChannelRegistry {
  return new ChannelRegistry()
    .register(new HighTribeAdapter(hightribe))
    .register(new EventbriteAdapter())
    .register(new LumaAdapter());
}

/* ───────────────── dry run ─────────────────
 * `npm run dry` builds the registry with a fake HighTribe client and prints the
 * exact Eventbrite + Luma request bodies for a sample event — no network calls,
 * no credentials. Proves the mapping end to end before you wire real keys.
 */
const SAMPLE: MasterEvent = {
  id: "evt_local_1",
  hostId: "host_umer",
  title: "Golden Hour Rooftop Session — Venice",
  summary: "Sunset music, local makers, golden-hour views.",
  description: "An intimate evening on a Venice rooftop — live acoustic as the sun drops over the Pacific.",
  coverImageUrl: "https://cdn.hightribe.co/venice-rooftop.jpg",
  category: "Music",
  tags: ["sunset", "rooftop", "venice", "live music"],
  startUtc: "2026-07-19T00:30:00Z", // 5:30pm PT
  endUtc: "2026-07-19T04:00:00Z",
  timezone: "America/Los_Angeles",
  format: "in_person",
  venueName: "Rooftop at Rose Ave",
  address: "118 Rose Ave",
  city: "Venice",
  region: "CA",
  postalCode: "90291",
  country: "US",
  latitude: 33.9982,
  longitude: -118.4695,
  ticketType: "paid",
  priceCents: 2500,
  currency: "USD",
  capacity: 150,
  minPerOrder: 1,
  maxPerOrder: 8,
  salesStartUtc: "2026-06-20T00:00:00Z",
  salesEndUtc: "2026-07-19T00:30:00Z",
  waitlist: true,
  visibility: "public",
  requireApproval: false,
  inviteOnly: false,
  showRemaining: true,
  hostName: "HighTribe · Venice Collective",
  refundPolicy: "Full refund up to 7 days before the event.",
  faq: "Parking? Street parking on Rose Ave.",
};

async function dryRun() {
  console.log("── Eventbrite event body ──");
  console.log(JSON.stringify(ebEventBody(SAMPLE, "venue_123"), null, 2));
  console.log("── Eventbrite ticket_class body ──");
  console.log(JSON.stringify(ebTicketClassBody(SAMPLE), null, 2));
  console.log("── Luma create body ──");
  console.log(JSON.stringify(lumaCreateBody(SAMPLE), null, 2));

  // capability gating, no network: HighTribe will "publish" via the fake client,
  // Eventbrite/Luma will fail with a clear "no connection" since none is passed.
  const fakeHighTribe: HighTribeClient = {
    async createEvent(_h, m) {
      return { id: "ht_evt_1", url: `https://hightribe.co/e/${m.id}` };
    },
    async updateEvent() {},
    async cancelEvent() {},
    async listRegistrations() {
      return [];
    },
  };
  const orchestrator = new PublishOrchestrator(buildRegistry(fakeHighTribe));
  const connections: Partial<Record<string, Connection>> = {
    hightribe: { channel: "hightribe", credentials: { internalHostId: "host_umer" } },
    // eventbrite / luma intentionally omitted in the dry run
  };
  const results = await orchestrator.publish(SAMPLE, ["hightribe", "eventbrite", "luma"], connections as never);
  console.log("── publish results (dry, no creds for EB/Luma) ──");
  console.log(JSON.stringify(results, null, 2));
  console.log("rollup:", rollupStatus(results));
}

if (require.main === module) {
  dryRun().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
