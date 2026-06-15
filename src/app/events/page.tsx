'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { EventFormat, TicketType, Visibility } from '@/lib/types'
import { Modal } from '@/components/Modal'
import { Toast, useToast } from '@/components/Toast'

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Australia/Sydney',
]

interface LumaEvent {
  api_id: string
  name: string
  start_at: string
  end_at: string
  timezone: string
  description?: string
  url?: string
  cover_url?: string
  geo_address_json?: { full_address?: string; city?: string; country?: string }
  meeting_url?: string
}

interface LumaEntry {
  event?: LumaEvent
  role?: string
}

interface EbEvent {
  id: string
  name?: { text?: string }
  start?: { utc?: string }
  end?: { utc?: string }
  description?: { text?: string }
  url?: string
  is_free?: boolean
}

interface UnifiedEvent {
  id: string
  source: 'luma' | 'eventbrite'
  title: string
  startUtc: string
  endUtc: string
  url?: string
}

function formatDate(utc: string) {
  try {
    return new Date(utc).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return utc }
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', background: '#0d1117', border: '1px solid #30363d',
  borderRadius: '6px', padding: '7px 10px', fontSize: '13px',
  color: '#e6edf3', outline: 'none',
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'block', fontSize: '12px', color: '#8b949e',
  marginBottom: '5px', fontWeight: 500,
}

interface FormData {
  title: string; summary: string; description: string
  startUtc: string; endUtc: string; timezone: string
  format: EventFormat; venueName: string; address: string
  city: string; country: string; onlineUrl: string
  ticketType: TicketType; priceCents: string; currency: string
  capacity: string; visibility: Visibility; tags: string
}

const EMPTY_FORM: FormData = {
  title: '', summary: '', description: '',
  startUtc: '', endUtc: '', timezone: 'UTC',
  format: 'in_person', venueName: '', address: '', city: '', country: '', onlineUrl: '',
  ticketType: 'free', priceCents: '', currency: 'USD',
  capacity: '', visibility: 'public', tags: '',
}

export default function EventsPage() {
  const [events, setEvents] = useState<UnifiedEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const { toasts, toast, removeToast } = useToast()

  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const unified: UnifiedEvent[] = []

      // Luma hosted events
      try {
        const lumaRes = await api.getLumaHostedEvents() as { entries?: LumaEntry[] }
        const entries = lumaRes.entries || []
        for (const e of entries) {
          if (e.event) {
            unified.push({
              id: e.event.api_id,
              source: 'luma',
              title: e.event.name || 'Untitled',
              startUtc: e.event.start_at,
              endUtc: e.event.end_at,
              url: e.event.url,
            })
          }
        }
      } catch {
        // Luma not configured or unavailable
      }

      // Eventbrite events (via organizations)
      try {
        const orgRes = await api.getEbOrganizations() as { organizations?: Array<{ id: string }> }
        const orgs = orgRes.organizations || []
        for (const org of orgs.slice(0, 1)) {
          const evtRes = await api.getEbOrgEvents(org.id) as { events?: EbEvent[] }
          const evts = evtRes.events || []
          for (const ev of evts.slice(0, 20)) {
            unified.push({
              id: ev.id,
              source: 'eventbrite',
              title: ev.name?.text || 'Untitled',
              startUtc: ev.start?.utc || new Date().toISOString(),
              endUtc: ev.end?.utc || new Date().toISOString(),
              url: ev.url,
            })
          }
        }
      } catch {
        // Eventbrite not configured or unavailable
      }

      // Sort by start date descending
      unified.sort((a, b) => new Date(b.startUtc).getTime() - new Date(a.startUtc).getTime())
      setEvents(unified)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadEvents() }, [loadEvents])

  const handleField = (field: keyof FormData, value: string) => {
    setForm((f) => ({ ...f, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) { toast.error('Title is required'); return }
    if (!form.startUtc) { toast.error('Start date is required'); return }
    if (!form.endUtc) { toast.error('End date is required'); return }
    setSubmitting(true)
    try {
      await api.createLumaEvent({
        name: form.title,
        summary: form.summary || undefined,
        description: form.description || undefined,
        start_at: new Date(form.startUtc).toISOString(),
        end_at: new Date(form.endUtc).toISOString(),
        timezone: form.timezone,
        meeting_url: form.onlineUrl || undefined,
        geo_address_json: form.address ? {
          full_address: form.address,
          city: form.city,
          country: form.country,
        } : undefined,
        capacity: form.capacity ? parseInt(form.capacity) : undefined,
        tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        require_rsvp_approval: false,
      })
      toast.success('Event created in Luma!')
      setModalOpen(false)
      setForm(EMPTY_FORM)
      await loadEvents()
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ maxWidth: '960px' }}>
      <Toast toasts={toasts} onRemove={removeToast} />

      {/* Page header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '28px',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#e6edf3' }}>
            Events
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#8b949e' }}>
            Events from your connected channels
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          style={{
            background: '#388bfd', border: 'none', borderRadius: '6px',
            color: '#fff', padding: '9px 18px', fontSize: '14px', fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          + Create Event
        </button>
      </div>

      {/* Event list */}
      {loading ? (
        <div style={{ color: '#8b949e', fontSize: '14px' }}>Loading events…</div>
      ) : events.length === 0 ? (
        <div
          style={{
            background: '#161b22', border: '2px dashed #30363d', borderRadius: '10px',
            padding: '60px 24px', textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📅</div>
          <div style={{ fontSize: '16px', color: '#e6edf3', marginBottom: '8px', fontWeight: 500 }}>
            No events yet
          </div>
          <p style={{ color: '#8b949e', fontSize: '14px', marginBottom: '20px' }}>
            Connect a channel first, or create a Luma event directly
          </p>
          <button
            onClick={() => setModalOpen(true)}
            style={{
              background: '#388bfd', border: 'none', borderRadius: '6px',
              color: '#fff', padding: '9px 18px', fontSize: '14px', fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Create Event
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {events.map((evt) => (
            <div
              key={`${evt.source}-${evt.id}`}
              style={{
                background: '#161b22', border: '1px solid #30363d',
                borderRadius: '10px', padding: '20px',
              }}
            >
              <div
                style={{
                  display: 'flex', alignItems: 'flex-start',
                  justifyContent: 'space-between', gap: '12px',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '15px', fontWeight: 600, color: '#e6edf3', marginBottom: '6px',
                    }}
                  >
                    {evt.title}
                  </div>
                  <div
                    style={{
                      display: 'flex', gap: '8px', flexWrap: 'wrap',
                      fontSize: '12px', color: '#8b949e', marginBottom: '8px',
                    }}
                  >
                    <span>📅 {formatDate(evt.startUtc)}</span>
                    <span>·</span>
                    <span
                      style={{
                        padding: '2px 7px', borderRadius: '4px',
                        background: evt.source === 'luma' ? 'rgba(34,211,238,0.1)' : 'rgba(251,191,36,0.1)',
                        border: `1px solid ${evt.source === 'luma' ? 'rgba(34,211,238,0.3)' : 'rgba(251,191,36,0.3)'}`,
                        color: evt.source === 'luma' ? '#22d3ee' : '#fbbf24',
                      }}
                    >
                      {evt.source === 'luma' ? '✨ Luma' : '🎫 Eventbrite'}
                    </span>
                  </div>
                </div>
                {evt.url && (
                  <a
                    href={evt.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      background: 'rgba(56,139,253,0.15)',
                      border: '1px solid rgba(56,139,253,0.4)',
                      borderRadius: '6px', color: '#388bfd',
                      padding: '6px 12px', fontSize: '12px', fontWeight: 500,
                      textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
                    }}
                  >
                    View ↗
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Event Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Create Luma Event" width={640}>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Title */}
            <div>
              <label style={LABEL_STYLE}>Title *</label>
              <input
                type="text" required value={form.title}
                onChange={(e) => handleField('title', e.target.value)}
                placeholder="Event title" style={INPUT_STYLE}
              />
            </div>

            {/* Summary */}
            <div>
              <label style={LABEL_STYLE}>Summary</label>
              <input
                type="text" value={form.summary}
                onChange={(e) => handleField('summary', e.target.value)}
                placeholder="Short description" style={INPUT_STYLE}
              />
            </div>

            {/* Description */}
            <div>
              <label style={LABEL_STYLE}>Description</label>
              <textarea
                value={form.description}
                onChange={(e) => handleField('description', e.target.value)}
                placeholder="Full event description"
                rows={3}
                style={{ ...INPUT_STYLE, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {/* Start / End */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={LABEL_STYLE}>Start *</label>
                <input
                  type="datetime-local" required value={form.startUtc}
                  onChange={(e) => handleField('startUtc', e.target.value)}
                  style={INPUT_STYLE}
                />
              </div>
              <div>
                <label style={LABEL_STYLE}>End *</label>
                <input
                  type="datetime-local" required value={form.endUtc}
                  onChange={(e) => handleField('endUtc', e.target.value)}
                  style={INPUT_STYLE}
                />
              </div>
            </div>

            {/* Timezone */}
            <div>
              <label style={LABEL_STYLE}>Timezone</label>
              <select
                value={form.timezone}
                onChange={(e) => handleField('timezone', e.target.value)}
                style={INPUT_STYLE}
              >
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>

            {/* Format */}
            <div>
              <label style={LABEL_STYLE}>Format</label>
              <select
                value={form.format}
                onChange={(e) => handleField('format', e.target.value as EventFormat)}
                style={INPUT_STYLE}
              >
                <option value="in_person">In Person</option>
                <option value="online">Online</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>

            {/* Venue fields (in_person / hybrid) */}
            {(form.format === 'in_person' || form.format === 'hybrid') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <label style={LABEL_STYLE}>Venue Name</label>
                  <input type="text" value={form.venueName}
                    onChange={(e) => handleField('venueName', e.target.value)}
                    placeholder="Venue name" style={INPUT_STYLE} />
                </div>
                <div>
                  <label style={LABEL_STYLE}>Address</label>
                  <input type="text" value={form.address}
                    onChange={(e) => handleField('address', e.target.value)}
                    placeholder="Street address" style={INPUT_STYLE} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={LABEL_STYLE}>City</label>
                    <input type="text" value={form.city}
                      onChange={(e) => handleField('city', e.target.value)}
                      placeholder="City" style={INPUT_STYLE} />
                  </div>
                  <div>
                    <label style={LABEL_STYLE}>Country</label>
                    <input type="text" value={form.country}
                      onChange={(e) => handleField('country', e.target.value)}
                      placeholder="Country" style={INPUT_STYLE} />
                  </div>
                </div>
              </div>
            )}

            {/* Online URL (online / hybrid) */}
            {(form.format === 'online' || form.format === 'hybrid') && (
              <div>
                <label style={LABEL_STYLE}>Online URL</label>
                <input type="url" value={form.onlineUrl}
                  onChange={(e) => handleField('onlineUrl', e.target.value)}
                  placeholder="https://meet.example.com/..." style={INPUT_STYLE} />
              </div>
            )}

            {/* Capacity */}
            <div>
              <label style={LABEL_STYLE}>Capacity</label>
              <input type="number" min="1" value={form.capacity}
                onChange={(e) => handleField('capacity', e.target.value)}
                placeholder="Unlimited" style={INPUT_STYLE} />
            </div>

            {/* Tags */}
            <div>
              <label style={LABEL_STYLE}>Tags (comma-separated)</label>
              <input type="text" value={form.tags}
                onChange={(e) => handleField('tags', e.target.value)}
                placeholder="music, tech, networking" style={INPUT_STYLE} />
            </div>

            {/* Submit */}
            <div
              style={{
                display: 'flex', justifyContent: 'flex-end', gap: '10px',
                paddingTop: '8px', borderTop: '1px solid #30363d',
              }}
            >
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{
                  background: 'none', border: '1px solid #30363d', borderRadius: '6px',
                  color: '#8b949e', padding: '8px 16px', fontSize: '14px', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  background: '#388bfd', border: 'none', borderRadius: '6px',
                  color: '#fff', padding: '8px 20px', fontSize: '14px', fontWeight: 500,
                  cursor: submitting ? 'default' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? 'Creating…' : 'Create Event'}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
