import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';

// Self hosted (latin subset, variable weight) so builds never depend on a font CDN.
const display = localFont({ src: '../fonts/BigShoulders.woff2', weight: '100 900', variable: '--f-display', display: 'swap' });
const body = localFont({ src: '../fonts/InstrumentSans.woff2', weight: '400 700', variable: '--f-body', display: 'swap' });
const mono = localFont({ src: '../fonts/JetBrainsMono.woff2', weight: '100 800', variable: '--f-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Lifeboat',
  description: 'Your USDC gets off before the vault sinks. Lifeboat watches the curators of your Morpho vault and moves your money to a safer vault you approved when they stay silent.',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#07121B' },
    { media: '(prefers-color-scheme: light)', color: '#F1ECE2' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <Nav />
        {children}
        <Footer />
      </body>
    </html>
  );
}
