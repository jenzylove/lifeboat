import type { Metadata, Viewport } from 'next';
import { Big_Shoulders_Display, Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';

const display = Big_Shoulders_Display({ subsets: ['latin'], weight: ['800', '900'], variable: '--f-display', display: 'swap' });
const body = Instrument_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--f-body', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--f-mono', display: 'swap' });

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
