import type { Metadata } from "next";
import LegalLayout from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Privacy Policy — Philoi",
};

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated="July 1, 2026">
      <p>
        This policy explains what information Philoi (&ldquo;we,&rdquo; &ldquo;us&rdquo;) collects
        when you use the Philoi app, why we collect it, and the choices you have. Philoi is a
        small-circle accountability app: you and a few friends check in with photos to keep each
        other honest on a shared goal.
      </p>

      <h2>Who Philoi is for</h2>
      <p>
        Philoi is intended for users <strong>18 years of age or older</strong>. We do not
        knowingly collect information from anyone under 18. See our{" "}
        <a href="/child-safety">Child Safety Standards</a> page for details.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information:</strong> the email address (or OAuth identity, e.g. Google)
          you sign in with, your display name, avatar, and the handle you choose.
        </li>
        <li>
          <strong>Profile details you provide:</strong> your school/university, if you choose to
          share it — used only to show you nearby circles and a school leaderboard.
        </li>
        <li>
          <strong>Check-in content:</strong> photos you take in-app to check in, any caption you
          add, and reactions/comments from your circle.
        </li>
        <li>
          <strong>Consent record:</strong> the date and policy version you agreed to when you
          confirmed you&apos;re 18+ and accepted these terms.
        </li>
        <li>
          <strong>Device &amp; usage data:</strong> a push-notification token (so we can notify
          you when a circle-mate checks in or your streak is at risk) and basic product-analytics
          events (e.g. that you completed a check-in) used to understand what&apos;s working.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        We use your information to run the core product: showing your circles&apos; check-ins to
        the people in them, computing streaks, sending the notifications you&apos;d expect from an
        accountability app, and improving Philoi based on aggregate usage patterns. We do not sell
        your personal information, and we do not use it for third-party advertising.
      </p>

      <h2>Who we share it with</h2>
      <p>
        We use a small number of service providers to run Philoi, each acting on our behalf under
        their own security commitments:
      </p>
      <ul>
        <li>
          <strong>Supabase</strong> — hosts our database, file storage (your check-in photos), and
          authentication.
        </li>
        <li>
          <strong>PostHog</strong> — product analytics, so we can see which parts of Philoi people
          actually use.
        </li>
        <li>
          <strong>Expo / Google Firebase Cloud Messaging</strong> — delivers push notifications to
          your device.
        </li>
      </ul>
      <p>
        Within the app, your check-in photos and profile are visible only to the members of the
        circles you&apos;re in — never to the public internet or to other Philoi users outside your
        circle, unless you join a circle marked open/discoverable.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your data for as long as your account is active. If you delete your account
        (Settings → Delete account), we immediately and permanently remove your profile, check-ins,
        photos, circle memberships, and related records from our systems.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Edit your profile, handle, and school at any time from Settings.</li>
        <li>Turn notifications on/off from Settings or your device&apos;s system settings.</li>
        <li>Delete your account and all associated data at any time from Settings.</li>
        <li>
          Contact us at{" "}
          <a href="mailto:legal@getphiloi.com">legal@getphiloi.com</a> for any other privacy
          request.
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        Access to circle content is enforced at the database level — only members of a circle can
        read that circle&apos;s check-ins and photos. We use industry-standard encryption in
        transit and at rest via our infrastructure provider.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If we make material changes to this policy, we&apos;ll update the date above and, where
        required, ask you to re-confirm your consent in-app before you can keep using Philoi.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy or your data? Email{" "}
        <a href="mailto:legal@getphiloi.com">legal@getphiloi.com</a>.
      </p>
    </LegalLayout>
  );
}
