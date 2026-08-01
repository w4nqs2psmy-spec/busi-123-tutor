import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'BUSI1620 Adaptive Tutor',
  description:
    'Adaptive generative-learning tutor for University of Greenwich BUSI1620 Business Creation Project.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
