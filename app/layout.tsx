import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
const sans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const mono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
export const metadata: Metadata = {
  title: 'Parcel — Options, by the share.',
  icons: { icon: '/favicon.svg' },
  description:
    'Granular options, covered underwriting, stock lending and collateral vaults. Every share accounted for.',
  openGraph: {
    title: 'Parcel — Options, by the share.',
    description: 'Precisely sized. Fully accounted for.',
    images: [
      {
        url: new URL(
          '/og.png',
          process.env.SITE_ORIGIN || 'http://trading-01:3025',
        ).href,
        width: 1733,
        height: 907,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Parcel — Options, by the share.',
    description: 'Precisely sized. Fully accounted for.',
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
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
