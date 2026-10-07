import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'НарядAI — общая рабочая смена',
  description: 'Мобильная система выдачи, выполнения и контроля ремонтных нарядов.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/company-emblem.png', apple: '/icon-192.png' },
  appleWebApp: { capable: true, title: 'НарядAI', statusBarStyle: 'default' },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" data-theme="light">
      <body>
        {children}
        <script src="/boot-guard.js" defer />
      </body>
    </html>
  );
}
