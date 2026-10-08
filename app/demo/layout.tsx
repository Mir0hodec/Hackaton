import type { Metadata } from 'next';
export const metadata: Metadata = { manifest: '/demo.webmanifest' };
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
