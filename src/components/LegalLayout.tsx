import Link from "next/link";
import Logo from "@/components/Logo";

export default function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-cream font-body text-ink">
      <header className="sticky top-0 z-50 border-b border-line bg-cream/95 backdrop-blur-sm">
        <nav className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/">
            <Logo size="sm" />
          </Link>
          <Link href="/" className="font-body text-sm text-muted hover:text-ink transition-colors">
            Back home
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-2">{title}</h1>
        <p className="font-body text-sm text-muted mb-10">Last updated {updated}</p>

        <div className="legal-content font-body text-ink leading-relaxed space-y-6">{children}</div>
      </main>

      <footer className="border-t border-line bg-cream">
        <div className="mx-auto max-w-3xl px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Logo size="sm" />
          <div className="flex gap-6 font-body text-sm text-muted">
            <Link href="/privacy" className="hover:text-ink transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-ink transition-colors">
              Terms
            </Link>
            <Link href="/child-safety" className="hover:text-ink transition-colors">
              Child Safety
            </Link>
            <a href="mailto:hello@getphiloi.com" className="hover:text-ink transition-colors">
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
