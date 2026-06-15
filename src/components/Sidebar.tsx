'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_LINKS = [
  { href: '/', label: 'Dashboard', icon: '⊞' },
  { href: '/channels', label: 'Channels', icon: '⛓' },
  { href: '/events', label: 'Events', icon: '📅' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
]

export function Sidebar() {
  const pathname = usePathname()
  const [hostId, setHostId] = useState('')

  useEffect(() => {
    const stored = localStorage.getItem('eventlifter_hostId') || ''
    setHostId(stored)
  }, [])

  const handleHostIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setHostId(val)
    localStorage.setItem('eventlifter_hostId', val)
  }

  return (
    <aside
      style={{
        width: '228px',
        flexShrink: 0,
        background: '#161b22',
        borderRight: '1px solid #30363d',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'fixed',
        left: 0,
        top: 0,
        zIndex: 100,
        overflowY: 'auto',
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: '20px 16px',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #388bfd, #a78bfa)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            flexShrink: 0,
          }}
        >
          ⚡
        </div>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#e6edf3', lineHeight: 1 }}>
            EventLifter
          </div>
          <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>
            Channel Manager
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 8px' }}>
        {NAV_LINKS.map(({ href, label, icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 12px',
                borderRadius: '6px',
                marginBottom: '2px',
                textDecoration: 'none',
                color: active ? '#e6edf3' : '#8b949e',
                background: active ? '#1c2128' : 'transparent',
                fontSize: '14px',
                fontWeight: active ? 500 : 400,
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: '15px', opacity: active ? 1 : 0.7 }}>{icon}</span>
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Host ID */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid #30363d',
        }}
      >
        <label
          style={{
            display: 'block',
            fontSize: '11px',
            color: '#8b949e',
            marginBottom: '6px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Host ID
        </label>
        <input
          type="text"
          value={hostId}
          onChange={handleHostIdChange}
          placeholder="your-host-id"
          style={{
            width: '100%',
            background: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: '6px',
            padding: '6px 10px',
            fontSize: '12px',
            color: '#e6edf3',
            outline: 'none',
          }}
        />
      </div>
    </aside>
  )
}
