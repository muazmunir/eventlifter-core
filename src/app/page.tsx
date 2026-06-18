'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { getSettings, getEvents } from '@/lib/api'
import { getUser } from '@/lib/auth'
import type { MasterEvent } from '@/lib/types'

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: string | number
  color: string
}) {
  return (
    <div
      style={{
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '10px',
        padding: '20px 24px',
        flex: 1,
        minWidth: '160px',
      }}
    >
      <div style={{ fontSize: '28px', fontWeight: 700, color, marginBottom: '4px' }}>
        {value}
      </div>
      <div style={{ fontSize: '13px', color: '#8b949e' }}>{label}</div>
    </div>
  )
}

function formatDate(utc: string) {
  try {
    return new Date(utc).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return utc
  }
}

function formatPrice(priceCents: number, currency: string) {
  if (priceCents === 0) return 'Free'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'USD',
  }).format(priceCents / 100)
}

type SafeSettings = {
  luma?: { configured?: boolean }
  eventbrite?: { configured?: boolean; hasPrivateToken?: boolean }
  hightribe?: { configured?: boolean }
}

export default function DashboardPage() {
  const [settings, setSettings] = useState<SafeSettings>({})
  const [events, setEvents] = useState<MasterEvent[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [settingsRes, eventsRes] = await Promise.allSettled([
        getSettings(),
        getEvents('default'),
      ])
      if (settingsRes.status === 'fulfilled') setSettings(settingsRes.value as SafeSettings)
      if (eventsRes.status === 'fulfilled') setEvents(eventsRes.value.events)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const lumaConfigured = !!(settings.luma?.configured)
  const ebConfigured = !!(settings.eventbrite?.configured || settings.eventbrite?.hasPrivateToken)
  const htUser = getUser()
  const htConfigured = !!htUser
  const recentEvents = events.slice(0, 3)
  const anyConfigured = lumaConfigured || ebConfigured || htConfigured

  return (
    <div style={{ maxWidth: '960px' }}>
      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#e6edf3' }}>
          Dashboard
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#8b949e' }}>
          Overview of your EventLifter channel manager
        </p>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '28px' }}>
        <StatCard
          label="Luma"
          value={loading ? '…' : lumaConfigured ? 'Connected' : 'Not set'}
          color={lumaConfigured ? '#22d3ee' : '#8b949e'}
        />
        <StatCard
          label="Eventbrite"
          value={loading ? '…' : ebConfigured ? 'Connected' : 'Not set'}
          color={ebConfigured ? '#fbbf24' : '#8b949e'}
        />
        <StatCard
          label="HighTribe"
          value={loading ? '…' : htConfigured ? (htUser?.name?.split(' ')[0] || 'Connected') : 'Not set'}
          color={htConfigured ? '#a78bfa' : '#8b949e'}
        />
      </div>

      {/* Configure prompt */}
      {!loading && !anyConfigured && (
        <div
          style={{
            background: '#161b22',
            border: '2px dashed #30363d',
            borderRadius: '10px',
            padding: '32px 24px',
            textAlign: 'center',
            marginBottom: '28px',
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚙️</div>
          <div style={{ fontSize: '16px', color: '#e6edf3', marginBottom: '8px', fontWeight: 500 }}>
            No channels configured yet
          </div>
          <p style={{ color: '#8b949e', fontSize: '14px', marginBottom: '20px' }}>
            Configure your channels in Settings to get started
          </p>
          <Link
            href="/settings"
            style={{
              display: 'inline-block',
              background: '#388bfd',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              padding: '9px 18px',
              fontSize: '14px',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Go to Settings
          </Link>
        </div>
      )}

      {/* Recent events */}
      {(loading || recentEvents.length > 0) && (
        <div
          style={{
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: '10px',
            padding: '20px 24px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '16px',
            }}
          >
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#e6edf3' }}>
              Recent Luma Events
            </h2>
            <Link
              href="/events"
              style={{ fontSize: '13px', color: '#388bfd', textDecoration: 'none' }}
            >
              All events →
            </Link>
          </div>

          {loading ? (
            <div style={{ color: '#8b949e', fontSize: '14px', padding: '20px 0' }}>Loading…</div>
          ) : recentEvents.length === 0 ? (
            <div
              style={{
                color: '#8b949e',
                fontSize: '14px',
                padding: '20px 0',
                textAlign: 'center',
              }}
            >
              No events yet.{' '}
              <Link href="/events?create=1" style={{ color: '#388bfd', textDecoration: 'none' }}>
                Create one →
              </Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {recentEvents.map((evt) => (
                <div
                  key={evt.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    background: '#1c2128',
                    borderRadius: '8px',
                    border: '1px solid #30363d',
                    gap: '12px',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '14px',
                        fontWeight: 500,
                        color: '#e6edf3',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {evt.title}
                    </div>
                    <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '3px' }}>
                      {formatDate(evt.startUtc)}
                      {' · '}
                      {formatPrice(evt.priceCents, evt.currency)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: '#0d1117',
                        border: '1px solid #30363d',
                        color: '#22d3ee',
                      }}
                    >
                      ✨ Luma
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
