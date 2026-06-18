import { NextRequest, NextResponse } from 'next/server'
import {
  listMasterEvents, getMasterEvent, createMasterEvent, linkChannelEvent,
} from '@/lib/event-registry'
import type { ChannelKey } from '@/lib/types'

export async function GET() {
  return NextResponse.json({ events: listMasterEvents() })
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    action?: string
    masterId?: string
    title?: string
    capacity?: number
    channel?: ChannelKey
    ref?: { eventId: string; ticketId?: string; url?: string }
  }

  if (body.action === 'create') {
    const master = createMasterEvent({
      title: body.title || 'Untitled',
      capacity: body.capacity || 150,
    })
    return NextResponse.json(master)
  }

  if (body.action === 'link' && body.masterId && body.channel && body.ref) {
    const master = linkChannelEvent(body.masterId, body.channel, body.ref)
    if (!master) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(master)
  }

  if (body.masterId) {
    const master = getMasterEvent(body.masterId)
    if (!master) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(master)
  }

  return NextResponse.json({ error: 'invalid request' }, { status: 400 })
}
