import type { Metadata } from 'next'
import { Geist, Geist_Mono, Crimson_Pro } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { CollapsibleSidebar } from '@/components/collapsible-sidebar'
import { AppStateProvider } from '@/contexts/app-state-context'
import './globals.css'

const geist = Geist({ 
  subsets: ["latin"],
  variable: '--font-geist-sans',
});
const geistMono = Geist_Mono({ 
  subsets: ["latin"],
  variable: '--font-geist-mono',
});
const crimsonPro = Crimson_Pro({
  subsets: ['latin'],
  variable: '--font-crimson-pro',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'v0 App',
  description: 'Created with v0',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Blocking script to prevent theme flash - runs before paint */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var theme = localStorage.getItem('theme');
              var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
              var appliedTheme = theme || (prefersDark ? 'dark' : 'light');
              
              document.documentElement.setAttribute('data-theme', appliedTheme);
              
              // Apply .dark class for generic dark mode styles if the theme is dark-based
              if (['dark', 'trade.xyz', 'hyperliquid.xyz', 'midnight'].indexOf(appliedTheme) !== -1) {
                document.documentElement.classList.add('dark');
              } else {
                document.documentElement.classList.remove('dark');
              }

              var accent = localStorage.getItem('accentColor');
              if (accent) {
                var colors = {
                  green: 'oklch(0.75 0.2 142)',
                  blue: 'oklch(0.65 0.22 250)',
                  orange: 'oklch(0.70 0.20 50)',
                  yellow: 'oklch(0.80 0.18 95)',
                  purple: 'oklch(0.65 0.25 290)',
                  pink: 'oklch(0.70 0.22 350)'
                };
                var color = colors[accent];
                if (color) {
                  document.documentElement.style.setProperty('--sidebar-primary', color);
                  document.documentElement.style.setProperty('--primary', color);
                  document.documentElement.style.setProperty('--accent', color);
                  document.documentElement.style.setProperty('--ring', color);
                  document.documentElement.style.setProperty('--sidebar-ring', color);
                }
              }
              var font = localStorage.getItem('font-theme');
              if (font) {
                document.documentElement.setAttribute('data-font', font);
              }
            } catch (e) {}
          })();
        `}} />
        <style dangerouslySetInnerHTML={{ __html: `
          /* Instant navigation - no transitions */
          * {
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
          /* Prevent layout shift */
          html, body {
            overflow-x: hidden;
          }
          /* GPU acceleration */
          main {
            transform: translateZ(0);
            backface-visibility: hidden;
          }
        `}} />
      </head>
      <body className={`${geist.variable} ${geistMono.variable} ${crimsonPro.variable} antialiased`} suppressHydrationWarning>
        <AppStateProvider>
          <div className="flex h-screen bg-background">
            <CollapsibleSidebar />
            <main className="flex-1 overflow-auto flex flex-col">
              {children}
            </main>
          </div>
        </AppStateProvider>
        <Analytics />
      </body>
    </html>
  )
}
