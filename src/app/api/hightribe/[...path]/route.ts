import { NextRequest, NextResponse } from 'next/server'
import { loadSettings } from '../../settings/route'

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  const settings = loadSettings()
  const { serviceUrl, apiKey } = settings.hightribe

  if (!serviceUrl) {
    // Return stub response — HighTribe native, offline
    return NextResponse.json({
      stub: true,
      message: 'HighTribe service URL not configured. Using stub.',
    })
  }

  const pathStr = path.join('/')
  const url = new URL(`${serviceUrl.replace(/\/$/, '')}/${pathStr}`)
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v))

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

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

export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
