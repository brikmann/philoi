import type { Metadata } from "next";
import { Fredoka, Nunito } from "next/font/google";
import "./globals.css";

const fredoka = Fredoka({
  subsets: ["latin"],
  variable: "--font-fredoka",
});

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
});

export const metadata: Metadata = {
  title: "Philoi — Lock in, together.",
  description:
    "Philoi puts your people around your goals — a small circle of friends chasing the same thing, holding each other to it. Join the waitlist.",
  openGraph: {
    title: "Philoi — Lock in, together.",
    description:
      "Philoi puts your people around your goals — a small circle of friends chasing the same thing, holding each other to it.",
    type: "website",
    siteName: "Philoi",
  },
  twitter: {
    card: "summary_large_image",
    title: "Philoi — Lock in, together.",
    description:
      "Philoi puts your people around your goals — a small circle of friends chasing the same thing, holding each other to it.",
  },
  icons: {
    icon: "/philoi_icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fredoka.variable} ${nunito.variable}`}>
      <body className="min-h-screen bg-cream antialiased">{children}</body>
    </html>
  );
}
