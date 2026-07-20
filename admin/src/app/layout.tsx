import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Philoi Admin',
  description: 'Moderation queue, beta metrics, and content browser.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
