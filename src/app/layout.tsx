import type { Metadata } from 'next'
import './globals.css'
import { Sidebar } from '@/components/Sidebar'
import { Topbar } from '@/components/Topbar'

export const metadata: Metadata = {
  title: 'EventLifter — Channel Manager',
  description: 'Manage your event publishing channels',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" style={{ height: '100%' }}>
      <body style={{ height: '100%', margin: 0, display: 'flex' }}>
        <Sidebar />
        <div
          style={{
            flex: 1,
            marginLeft: '228px',
            display: 'flex',
            flexDirection: 'column',
            minHeight: '100vh',
            background: '#0d1117',
          }}
        >
          <Topbar />
          <main
            style={{
              flex: 1,
              padding: '28px 32px',
              overflowY: 'auto',
            }}
          >
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
