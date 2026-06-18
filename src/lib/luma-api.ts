import { loadSettings } from '@/app/api/settings/route'

export class LumaApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errorCode?: string,
  ) {
    super(message)
    this.name = 'LumaApiError'
  }
}

function getConfig() {
  const s = loadSettings()
  const apiKey = s.luma.apiKey
  const base = (s.luma.apiBaseUrl || 'https://public-api.luma.com').replace(/\/$/, '')
  if (!apiKey) throw new LumaApiError('Luma API key not configured. Go to Settings → Luma.', 400)
  return { apiKey, base }
}

async function lumaRequest(
  method: string,
  path: string,
  opts?: { query?: Record<string, string>; body?: unknown },
): Promise<Record<string, unknown>> {
  const { apiKey, base } = getConfig()
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`)
  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v)
    }
  }

  const init: RequestInit = {
    method,
    headers: {
      'x-luma-api-key': apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  }
  if (opts?.body && method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(opts.body)
  }

  const res = await fetch(url.toString(), init)
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try { data = text ? JSON.parse(text) as Record<string, unknown> : {} } catch { data = { raw: text } }

  if (!res.ok) {
    const msg = String(data.message || data.error || text || `Luma HTTP ${res.status}`)
    throw new LumaApiError(msg, res.status, String(data.error || ''))
  }
  return data
}

/** Mirrors HighTribe Laravel LumaService::listHostedEvents */
export async function listHostedEvents(query: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const fetchAll = query.fetch_all === 'true'
  const upcomingOnly = query.upcoming_only !== 'false'

  const params: Record<string, string> = {
    platforms: 'luma',
    status: 'approved',
    sort_column: 'start_at',
    sort_direction: 'asc nulls last',
    ...query,
  }
  delete params.fetch_all
  delete params.upcoming_only

  if (upcomingOnly && !params.after) {
    params.after = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  }

  if (!fetchAll) {
    const result = await lumaRequest('GET', '/v1/calendars/events/list', { query: params })
    return { ...result, source: 'luma_calendar_hosted' }
  }

  const allEntries: unknown[] = []
  let cursor: string | null = null
  do {
    if (cursor) params.pagination_cursor = cursor
    else delete params.pagination_cursor
    const page = await lumaRequest('GET', '/v1/calendars/events/list', { query: params })
    const entries = page.entries
    if (Array.isArray(entries)) allEntries.push(...entries)
    cursor = page.next_cursor ? String(page.next_cursor) : null
  } while (cursor)

  return { entries: allEntries, count: allEntries.length, has_more: false, source: 'luma_calendar_hosted' }
}

/** Map Next.js proxy path segments to Luma API */
export async function proxyLumaPath(
  pathSegments: string[],
  method: string,
  query: Record<string, string>,
  body?: unknown,
): Promise<{ data: unknown; status: number }> {
  const path = pathSegments.join('/')

  if (path === 'events/hosted' && method === 'GET') {
    return { data: await listHostedEvents(query), status: 200 }
  }

  if (path === 'events' && method === 'GET') {
    const eventId = query.api_id || query.event_id || query.event_api_id
    if (!eventId) throw new LumaApiError('api_id or event_id required', 400)
    return { data: await lumaRequest('GET', '/v1/events/get', { query: { event_api_id: eventId } }), status: 200 }
  }

  if (path === 'events' && method === 'POST') {
    return { data: await lumaRequest('POST', '/v1/events/create', { body }), status: 201 }
  }

  if (path === 'events' && method === 'PUT') {
    return { data: await lumaRequest('POST', '/v1/events/update', { body }), status: 200 }
  }

  if (path === 'events/create' && method === 'POST') {
    return { data: await lumaRequest('POST', '/v1/events/create', { body }), status: 201 }
  }

  if (path === 'events/cancel' && method === 'POST') {
    return { data: await lumaRequest('POST', '/v1/events/cancel', { body }), status: 200 }
  }

  if (path === 'users/self' && method === 'GET') {
    return { data: await lumaRequest('GET', '/v1/users/get-self'), status: 200 }
  }

  if (path === 'calendars' && method === 'GET') {
    return { data: await lumaRequest('GET', '/v1/calendars/get'), status: 200 }
  }

  if (path === 'webhooks' && method === 'GET') {
    return { data: await lumaRequest('GET', '/v1/webhooks/list', { query }), status: 200 }
  }

  if (path === 'webhooks' && method === 'POST') {
    return { data: await lumaRequest('POST', '/v2/webhooks/create', { body }), status: 201 }
  }

  if (path === 'webhooks' && method === 'PUT') {
    return { data: await lumaRequest('POST', '/v2/webhooks/update', { body }), status: 200 }
  }

  if (path === 'webhooks' && method === 'DELETE') {
    return { data: await lumaRequest('POST', '/v1/webhooks/delete', { body }), status: 200 }
  }

  if (path === 'ticket-types' && method === 'GET') {
    return { data: await lumaRequest('GET', '/v1/event/ticket-types/list', { query }), status: 200 }
  }

  if (path === 'ticket-types' && method === 'PUT') {
    return { data: await lumaRequest('POST', '/v1/event/ticket-types/update', { body }), status: 200 }
  }

  if (path === 'guests' && method === 'GET') {
    return { data: await lumaRequest('GET', '/v1/event/guests/list', { query }), status: 200 }
  }

  // Fallback: pass through as /v1/{path}
  const lumaPath = `/v1/${path.replace(/\//g, '/')}`
  if (method === 'GET') return { data: await lumaRequest('GET', lumaPath, { query }), status: 200 }
  if (method === 'POST') return { data: await lumaRequest('POST', lumaPath, { body }), status: 200 }
  if (method === 'PUT') return { data: await lumaRequest('POST', lumaPath.replace('/update', '/update'), { body }), status: 200 }
  throw new LumaApiError(`Unsupported Luma route: ${method} ${path}`, 404)
}
