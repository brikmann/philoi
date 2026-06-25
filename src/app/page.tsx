import WaitlistForm from "@/components/WaitlistForm";
import Logo from "@/components/Logo";

function CampfireIcon({ className = "w-20 h-20" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 140 140"
      className={className}
      aria-hidden="true"
    >
      <rect x="6" y="6" width="128" height="128" rx="34" fill="#3A2E5C" />
      <path d="M70,28 C52,54 49,70 70,86 C91,70 88,54 70,28 Z" fill="#E0612C" />
      <path d="M70,46 C59,62 58,76 70,86 C82,76 81,62 70,46 Z" fill="#F2A33C" />
      <path d="M70,62 C64,72 64,80 70,86 C76,80 76,72 70,62 Z" fill="#FFD27A" />
      <line x1="48" y1="96" x2="78" y2="84" stroke="#9C6336" strokeWidth="6" strokeLinecap="round" />
      <line x1="62" y1="84" x2="92" y2="96" stroke="#7E4A2C" strokeWidth="6" strokeLinecap="round" />
      <circle cx="70" cy="92" r="2" fill="#FFD27A" />
    </svg>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  return (
    <div className="min-h-screen bg-cream font-body text-ink">

      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 border-b border-line bg-cream/95 backdrop-blur-sm">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex flex-col gap-0.5">
            <Logo size="md" />
            <span className="font-body text-xs text-muted leading-none pl-10">
              Greek for <em>your people</em>
            </span>
          </div>
          <a
            href="#signup"
            className="rounded-2xl bg-coral px-5 py-2.5 font-display font-semibold text-sm text-white shadow-[0_4px_14px_rgba(224,97,44,0.25)] hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            Get early access
          </a>
        </nav>
      </header>

      {/* ── Hero ── */}
      <section className="mx-auto max-w-2xl px-6 pt-20 pb-28 text-center">
        <div className="flex justify-center mb-6">
          <CampfireIcon className="w-20 h-20 sm:w-24 sm:h-24" />
        </div>

        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-semibold text-ink leading-tight mb-6">
          Lock in — together.
        </h1>

        <p className="font-body text-lg sm:text-xl text-muted leading-relaxed mb-10 max-w-lg mx-auto">
          You don&apos;t fail your goals because you don&apos;t know what to do. You fail because
          you do it alone. Philoi puts{" "}
          <strong className="text-ink font-semibold">your people</strong> around you — a small
          circle chasing the same goal, holding each other to it.
        </p>

        <div id="signup">
          <WaitlistForm referredBy={ref} />
        </div>
        <p className="mt-4 font-body text-xs text-muted">Be a founding member.</p>
      </section>

      {/* ── Problem ── */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-ink mb-4">
            The real reason you&apos;re not hitting your goals
          </h2>
          <p className="font-body text-muted mb-12 max-w-lg mx-auto">
            It&apos;s not motivation. It&apos;s not discipline. It&apos;s who&apos;s around you.
          </p>
          <div className="grid gap-5 sm:grid-cols-3">
            {[
              {
                icon: "📋",
                heading: "You have a plan.",
                text: "You know the steps. You've set this goal before. The information isn't the problem.",
              },
              {
                icon: "🫥",
                heading: "Nobody notices.",
                text: "No one around you is doing the same thing. Nobody checks in. Nobody sees if you ghost.",
              },
              {
                icon: "🔁",
                heading: "So you stop.",
                text: "Then restart. Then stop again. Not because you're weak — because you're doing it alone.",
              },
            ].map(({ icon, heading, text }) => (
              <div key={heading} className="rounded-2xl bg-card border border-line p-6 text-left">
                <div className="text-3xl mb-3">{icon}</div>
                <h3 className="font-display font-semibold text-ink text-base mb-2">{heading}</h3>
                <p className="font-body text-sm text-muted leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
          <p className="mt-12 font-display text-xl sm:text-2xl font-semibold text-coral max-w-xl mx-auto leading-snug">
            Your environment decides whether you follow through — not your willpower.
          </p>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="bg-plum">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-cream mb-3">
            How Philoi works
          </h2>
          <p className="font-body text-cream/60 mb-12">
            Simple. Warm. Built for real follow-through.
          </p>
          <div className="grid gap-5 sm:grid-cols-3">
            {[
              {
                step: "1",
                accent: "bg-coral",
                title: "Pick a goal.",
                desc: "Set the thing you actually want to do — run a 5K, ship a project, study consistently. One goal, real stakes.",
              },
              {
                step: "2",
                accent: "bg-amber",
                title: "Bring your circle.",
                desc: "Invite 2–4 friends chasing the same thing — plus one who's already crushing it. That's your Philoi.",
              },
              {
                step: "3",
                accent: "bg-green",
                title: "Keep each other to it.",
                desc: "Check in, share progress, see each other show up. When someone slips, the circle's there. Nobody ghosts.",
              },
            ].map(({ step, accent, title, desc }) => (
              <div
                key={step}
                className="rounded-2xl bg-[rgba(255,255,255,0.07)] border border-[rgba(255,255,255,0.10)] p-6 text-left"
              >
                <div
                  className={`${accent} w-9 h-9 rounded-xl flex items-center justify-center mb-4 shrink-0`}
                >
                  <span className="font-display font-semibold text-white text-base">{step}</span>
                </div>
                <h3 className="font-display text-lg font-semibold text-cream mb-2">{title}</h3>
                <p className="font-body text-sm text-cream/65 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why it works ── */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-2xl px-6 py-20 text-center">
          <h2 className="font-display text-2xl sm:text-3xl font-semibold text-ink mb-8">
            The science is simple.
          </h2>
          <blockquote className="rounded-2xl bg-card border border-line px-8 py-8 text-left">
            <p className="font-body text-lg sm:text-xl text-ink leading-relaxed">
              &ldquo;We hit goals far more often with an accountability partner — and we try harder
              when someone who&apos;s already great at the goal is in the room with us.&rdquo;
            </p>
            <footer className="mt-5 font-body text-sm text-muted">
              Köhler effect &amp; accountability research
            </footer>
          </blockquote>
          <p className="mt-8 font-body text-base text-muted max-w-sm mx-auto">
            Philoi doesn&apos;t add another app to your routine. It adds the people who make the
            difference.
          </p>
        </div>
      </section>

      {/* ── A Peek ── */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <h2 className="font-display text-3xl font-semibold text-ink text-center mb-3">
            Here&apos;s what it looks like
          </h2>
          <p className="font-body text-muted text-center mb-12">
            Goal → Circle → Check-in. That&apos;s the whole loop.
          </p>

          <div className="rounded-3xl border-2 border-line bg-card p-6 sm:p-8 flex flex-col sm:flex-row items-stretch gap-3 sm:gap-4">
            {/* Step 1 */}
            <div className="flex-1 rounded-2xl bg-cream border border-line p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-coral flex items-center justify-center text-white text-xs font-display font-semibold shrink-0">
                  1
                </span>
                <span className="font-display font-semibold text-ink text-sm">Your goal</span>
              </div>
              <div className="rounded-xl bg-coral/10 border border-coral/20 px-3 py-2 mb-2">
                <p className="font-body text-sm text-coral font-semibold">Run 3× a week</p>
              </div>
              <p className="font-body text-xs text-muted">for 8 weeks</p>
            </div>

            <div className="hidden sm:flex items-center text-line text-2xl font-body select-none">→</div>
            <div className="sm:hidden flex justify-center text-line text-xl font-body select-none">↓</div>

            {/* Step 2 */}
            <div className="flex-1 rounded-2xl bg-cream border border-line p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-amber flex items-center justify-center text-white text-xs font-display font-semibold shrink-0">
                  2
                </span>
                <span className="font-display font-semibold text-ink text-sm">Your circle</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {["You", "Mia", "James", "★ Alex"].map((name) => (
                  <span
                    key={name}
                    className={`rounded-full px-2.5 py-1 text-xs font-body font-semibold ${
                      name.startsWith("★")
                        ? "bg-ember text-[#9A6A12]"
                        : "bg-line text-ink"
                    }`}
                  >
                    {name}
                  </span>
                ))}
              </div>
              <p className="font-body text-xs text-muted">Alex is your achiever</p>
            </div>

            <div className="hidden sm:flex items-center text-line text-2xl font-body select-none">→</div>
            <div className="sm:hidden flex justify-center text-line text-xl font-body select-none">↓</div>

            {/* Step 3 */}
            <div className="flex-1 rounded-2xl bg-cream border border-line p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-green flex items-center justify-center text-white text-xs font-display font-semibold shrink-0">
                  3
                </span>
                <span className="font-display font-semibold text-ink text-sm">This week</span>
              </div>
              <div className="flex flex-col gap-2">
                {[
                  { name: "You", done: true },
                  { name: "Mia", done: true },
                  { name: "James", done: false },
                  { name: "Alex", done: true },
                ].map(({ name, done }) => (
                  <div key={name} className="flex items-center gap-2">
                    <span
                      className={`w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] shrink-0 ${
                        done ? "bg-green" : "border-2 border-line bg-transparent"
                      }`}
                    >
                      {done && "✓"}
                    </span>
                    <span className="font-body text-xs text-ink">{name}</span>
                    {!done && (
                      <span className="font-body text-[10px] text-muted ml-auto">not yet</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="bg-plum">
        <div className="mx-auto max-w-xl px-6 py-24 text-center">
          <CampfireIcon className="w-14 h-14 mx-auto mb-6 opacity-90" />
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-cream mb-4 leading-tight">
            Your goals are easier with your people.
          </h2>
          <p className="font-body text-cream/60 mb-10 text-base max-w-sm mx-auto">
            Save your spot — founding members help shape what Philoi becomes.
          </p>
          <WaitlistForm referredBy={ref} variant="dark" />
          <p className="mt-5 font-body text-xs text-cream/35">No spam. Just Philoi.</p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-line bg-cream">
        <div className="mx-auto max-w-5xl px-6 py-12 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex flex-col items-center sm:items-start gap-1">
            <Logo size="sm" />
            <p className="font-body text-xs text-muted">Lock in — together.</p>
          </div>
          <div className="flex gap-6 font-body text-sm text-muted">
            <a href="mailto:hello@getphiloi.com" className="hover:text-ink transition-colors">
              Contact
            </a>
            <a href="#" className="hover:text-ink transition-colors">
              Instagram
            </a>
            <a href="#" className="hover:text-ink transition-colors">
              X / Twitter
            </a>
          </div>
          <p className="font-body text-xs text-muted">© 2026 Philoi</p>
        </div>
      </footer>
    </div>
  );
}
