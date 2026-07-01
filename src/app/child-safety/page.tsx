import type { Metadata } from "next";
import LegalLayout from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Child Safety Standards — Philoi",
};

export default function ChildSafetyPage() {
  return (
    <LegalLayout title="Child Safety Standards" updated="July 1, 2026">
      <p>
        Philoi has zero tolerance for child sexual abuse and exploitation (CSAE) — in any form,
        anywhere on our platform. This page explains who Philoi is for, how we prevent and respond
        to CSAE, and how to report a concern.
      </p>

      <h2>Philoi is an adults-only app</h2>
      <p>
        Philoi is built for users <strong>18 years of age or older</strong>. Every account must
        explicitly confirm they&apos;re 18+ and accept our{" "}
        <a href="/terms">Terms of Service</a> before they can use the app. We do not knowingly
        allow anyone under 18 to create or use an account, and we remove accounts we become aware
        of that belong to a minor.
      </p>

      <h2>Our commitment</h2>
      <ul>
        <li>
          We prohibit any content or behavior that sexualizes, endangers, or exploits a minor,
          without exception.
        </li>
        <li>
          Every check-in in the app has a &ldquo;Report&rdquo; option with a dedicated{" "}
          <strong>&ldquo;Child safety / CSAE&rdquo;</strong> reason, so this category of report is
          never buried behind a generic flow.
        </li>
        <li>We review every report and commit to taking action within 48 hours.</li>
        <li>
          Accounts found to have violated this policy are permanently removed, and the underlying
          report is preserved for law enforcement rather than deleted.
        </li>
        <li>
          Users can also block another account directly, immediately hiding that person&apos;s
          content from their feed.
        </li>
      </ul>

      <h2>How to report a concern</h2>
      <p>
        In the app, tap the <strong>&middot;&middot;&middot;</strong> menu on any check-in and
        choose <strong>Report</strong>, then <strong>Child safety / CSAE</strong>. You can also
        email us directly at{" "}
        <a href="mailto:legal@getphiloi.com">legal@getphiloi.com</a>.
      </p>
      <p>
        For urgent concerns, or to report CSAE content or behavior outside of Philoi as well,
        please also contact{" "}
        <a href="https://www.cybertip.ca" target="_blank" rel="noreferrer">
          Cybertip.ca
        </a>
        , or your local law enforcement.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy?{" "}
        <a href="mailto:legal@getphiloi.com">legal@getphiloi.com</a>.
      </p>
    </LegalLayout>
  );
}
