import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
const sans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const mono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
export const metadata: Metadata = {
  title: 'Strata — Your onchain equity desk',
  description:
    'Build defined-risk equity protection on Solana. Replay historical markets, fund transparent escrow, and follow every settlement.',
  openGraph: {
    title: 'Strata — Your onchain equity desk',
    description: 'Own the upside. Define the downside.',
    images: [
      {
        url: new URL(
          '/og.png',
          process.env.SITE_ORIGIN || 'http://trading-01:3025',
        ).href,
        width: 1536,
        height: 1024,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Strata — Your onchain equity desk',
    description: 'Own the upside. Define the downside.',
    images: [
      new URL('/og.png', process.env.SITE_ORIGIN || 'http://trading-01:3025')
        .href,
    ],
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${sans.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
