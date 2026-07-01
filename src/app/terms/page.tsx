import type { Metadata } from "next";
import LegalLayout from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Terms of Service — Philoi",
};

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" updated="July 1, 2026">
      <p>
        These terms govern your use of the Philoi app. By creating an account, you agree to them.
        Please read them along with our <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>1. Eligibility</h2>
      <p>
        Philoi is for users <strong>18 years of age or older</strong>. By creating an account, you
        confirm that you meet this requirement. We may suspend or terminate accounts we reasonably
        believe belong to someone under 18.
      </p>

      <h2>2. Your account</h2>
      <p>
        You&apos;re responsible for the activity on your account and for keeping your login secure.
        Provide accurate information when you sign up, and let us know if you believe your account
        has been compromised.
      </p>

      <h2>3. Your content</h2>
      <p>
        You own the photos and captions you post. By posting them, you grant Philoi a license to
        store and display that content to the members of the circle(s) you post it in, solely to
        operate the app. We don&apos;t sell your content or use it for advertising.
      </p>
      <p>
        Check-ins are camera-only by design — Philoi is proof that you showed up, not a photo
        library upload. Don&apos;t post content that isn&apos;t genuinely from your check-in.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You agree not to use Philoi to:</p>
      <ul>
        <li>Post content that is illegal, harassing, hateful, sexually explicit, or violent.</li>
        <li>
          Post or facilitate any content involving the sexual exploitation or abuse of a minor —
          this is never tolerated, see our <a href="/child-safety">Child Safety Standards</a>.
        </li>
        <li>Impersonate another person or misrepresent your identity or age.</li>
        <li>Harass, bully, or threaten another user.</li>
        <li>Spam, scrape, or attempt to disrupt the service.</li>
        <li>Attempt to access another user&apos;s account or circle without authorization.</li>
      </ul>

      <h2>5. Reporting &amp; moderation</h2>
      <p>
        You can report or block another user directly from their check-in. We review reports and
        may remove content, warn, suspend, or permanently ban accounts that violate these terms,
        at our discretion and without prior notice for serious violations.
      </p>

      <h2>6. Account deletion</h2>
      <p>
        You can delete your account at any time from Settings. This immediately and permanently
        removes your profile, check-ins, photos, and circle memberships — it can&apos;t be undone.
      </p>

      <h2>7. Disclaimers</h2>
      <p>
        Philoi is provided &ldquo;as is.&rdquo; We don&apos;t guarantee that using Philoi will help
        you achieve any particular goal — the app is a tool for accountability, not a substitute
        for your own effort, and we make no warranties about uptime, accuracy, or fitness for a
        particular purpose.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, Philoi and its team are not liable for any
        indirect, incidental, or consequential damages arising from your use of the app.
      </p>

      <h2>9. Termination</h2>
      <p>
        We may suspend or terminate your access to Philoi if you violate these terms. You may stop
        using Philoi and delete your account at any time.
      </p>

      <h2>10. Changes to these terms</h2>
      <p>
        We may update these terms as Philoi evolves. If we make a material change, we&apos;ll ask
        you to re-confirm your acceptance in-app before you can keep using Philoi.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions about these terms? Email{" "}
        <a href="mailto:hello@getphiloi.com">hello@getphiloi.com</a>.
      </p>
    </LegalLayout>
  );
}
