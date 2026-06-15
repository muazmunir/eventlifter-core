import { NextRequest, NextResponse } from 'next/server'
import { loadSettings } from '../../settings/route'

const LUMA_BASE = 'https://public-api.luma.com'
const DISCOVER_BASE = 'https://api.lu.ma'

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  const pathStr = '/' + path.join('/')
  const settings = loadSettings()

  // Discover endpoints don't need API key
  const isDiscover = pathStr.startsWith('/discover')

  if (!isDiscover && !settings.luma.apiKey) {
    return NextResponse.json(
      { error: 'Luma API key not configured. Go to Settings → Luma.' },
      { status: 400 }
    )
  }

  const base = isDiscover ? DISCOVER_BASE : (settings.luma.apiBaseUrl || LUMA_BASE)

  // Map our path to Luma v1 paths
  const lumaPath = mapLumaPath(pathStr)

  const url = new URL(`${base}${lumaPath}`)
  // Forward query params
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v))

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (!isDiscover) headers['x-luma-api-key'] = settings.luma.apiKey

  const init: RequestInit = { method: req.method, headers }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      init.body = await req.text()
    } catch {
      // ignore body read errors
    }
  }

  try {
    const upstream = await fetch(url.toString(), init)
    const text = await upstream.text()
    const data = text ? JSON.parse(text) : {}
    return NextResponse.json(data, { status: upstream.status })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

function mapLumaPath(p: string): string {
  const map: Record<string, string> = {
    '/users/self': '/v1/user/self',
    '/entity/lookup': '/v1/entity/lookup',
    '/calendars': '/v1/calendar/get',
    '/calendars/events': '/v1/calendar/list-events',
    '/calendars/admins': '/v1/calendar/list-admins',
    '/calendars/coupons': '/v1/calendar/list-coupons',
    '/calendars/lookup-event': '/v1/calendar/lookup-event',
    '/calendars/events/add': '/v1/calendar/add-event',
    '/calendars/events/approve': '/v1/calendar/approve-event',
    '/calendars/events/reject': '/v1/calendar/reject-event',
    '/calendars/coupons/create': '/v1/calendar/create-coupon',
    '/events': '/v1/event/get',
    '/events/hosted': '/v1/event/list-hosted-events',
    '/events/create': '/v1/event/create',
    '/events/update': '/v1/event/update',
    '/events/cancel': '/v1/event/cancel',
    '/guests': '/v1/event/get-guests',
    '/guests/detail': '/v1/event/get-guest',
    '/guests/add': '/v1/event/add-guests',
    '/guests/invite': '/v1/event/invite-guests',
    '/guests/status': '/v1/event/update-guest-status',
    '/ticket-types': '/v1/event/get-ticket-types',
    '/ticket-types/create': '/v1/event/create-ticket-type',
    '/ticket-types/update': '/v1/event/update-ticket-type',
    '/ticket-types/delete': '/v1/event/delete-ticket-type',
    '/event-tags': '/v1/event/tag/list',
    '/event-tags/create': '/v1/event/tag/create',
    '/event-tags/update': '/v1/event/tag/update',
    '/event-tags/delete': '/v1/event/tag/delete',
    '/event-tags/apply': '/v1/event/tag/apply',
    '/event-tags/unapply': '/v1/event/tag/unapply',
    '/event-coupons': '/v1/event/coupon/list',
    '/event-coupons/create': '/v1/event/coupon/create',
    '/webhooks': '/v1/webhooks/list',
    '/webhooks/create': '/v1/webhooks/create',
    '/webhooks/delete': '/v1/webhooks/delete',
    '/contacts': '/v1/contact/list',
    '/contact-tags': '/v1/contact/tag/list',
    '/memberships/tiers': '/v1/membership/list-tiers',
    '/organizations/calendars': '/v1/organization/list-calendars',
    '/organizations/events': '/v1/organization/list-events',
    '/images/upload-url': '/v1/image/get-upload-url',
    '/discover': '/public/v2/discover/events/paginated',
    '/discover/meta': '/public/v2/discover/meta',
  }
  return map[p] || p
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
export const PATCH = handler
