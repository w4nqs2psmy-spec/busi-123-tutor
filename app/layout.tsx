import type { Metadata } from 'next';
import { Inter, Sora } from 'next/font/google';

import './globals.css';

/**
 * Fonts are loaded through next/font, not an @import in a style tag: they are
 * self-hosted at build time, so there is no render-blocking request to Google
 * and no layout shift. The CSS variables are what browse.module.css reads.
 */
const sora = Sora({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-sora',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'BUSI1620 Adaptive Tutor',
  description:
    'Adaptive generative-learning tutor for University of Greenwich BUSI1620 Business Creation Project.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${sora.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
