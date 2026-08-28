# Code Prompt — Publish the Terms of Service on the website

**Goal:** The site (`site/`, deployed at philoi.app) has a live Privacy Policy at `/privacy.html` but **no Terms of Service page** and no link to one. Publish the existing ToS content as `site/terms.html`, styled identically to the privacy page, and link it everywhere the privacy page is linked. App stores and IT vetting both require a reachable Terms URL.

## Source of truth
- **Content:** `philoi_terms_of_service.md` (repo root) — this is the ToS copy to publish. Do **not** rewrite the legal content; just convert its sections/headings faithfully to HTML.
- **Template:** `site/privacy.html` — copy its exact structure, `<head>` (meta/OG/canonical), header nav, footer, and CSS/class names. The new page must look like a sibling of the privacy page, not a new design.

## Do this
1. **Create `site/terms.html`** by cloning `site/privacy.html` and swapping the body content for the Terms of Service from `philoi_terms_of_service.md`:
   - `<title>Terms of Service — Philoi</title>`
   - `<link rel="canonical" href="https://philoi.app/terms.html">`
   - Update all OG/Twitter meta (`og:url`, `og:title`, `og:description`, twitter equivalents) to the Terms page.
   - `<h1>Terms of Service</h1>` + the sections from the markdown, using the same heading/paragraph/list classes as privacy.html.
   - Keep the same contact line style, pointing to **nb@philoi.app**.
   - Add a "Last updated: [date]" line matching how privacy.html handles it (if it does).

2. **Add "Terms" links wherever "Privacy" is linked**, using the same markup:
   - `site/index.html` header nav (next to the `/privacy.html` link, ~line 842).
   - `site/index.html` footer (next to the "Privacy Policy" spacer link, ~line 1258) — label it **"Terms"** or **"Terms of Service"**.
   - `site/privacy.html` footer — add a reciprocal **Terms** link so the two legal pages cross-link.

3. **SEO/crawl:**
   - Add `<url><loc>https://philoi.app/terms.html</loc></url>` to `site/sitemap.xml`.
   - Confirm `site/robots.txt` doesn't disallow it (it shouldn't).

4. **Verify:** open `site/terms.html` locally — it renders with the same header/footer/styling as privacy.html, the canonical/OG tags point to terms.html, and every place that linked Privacy now also links Terms. No broken links, no leftover "Privacy Policy" title/canonical copied from the template.

## Out of scope
- No changes to the legal wording of the ToS (publish as-is from the markdown).
- No redesign of the site.
- Deploy is handled separately (Vercel) — just land the files.

**Result:** `https://philoi.app/terms.html` live and linked, ready to hand to Laurier IT and drop into the App Store / Play Store listing fields alongside the privacy URL.
