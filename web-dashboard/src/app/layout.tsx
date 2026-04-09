import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Wallet Hub',
  description: 'Business messages, orders, and phone data in one dashboard.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" style={{ backgroundColor: '#020617' }}>
      <body
        className={`${inter.className} bg-slate-950 text-slate-50 min-h-screen antialiased`}
        style={{
          backgroundColor: '#020617',
          color: '#f1f5f9',
          minHeight: '100vh',
        }}
      >
        {children}
      </body>
    </html>
  )
}
