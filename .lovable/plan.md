# Plan: SEO, i18n, auth & user features

## 1. SEO — per-event pages + sitewide polish

**Why your site loses to evenemangskollen**: every concert on this site lives at `/` only. Google has nothing to index per-event. Evenemangskollen has a dedicated URL per event with the event name in the URL, title, H1 and JSON-LD — so they rank for "<artist> | <venue>" queries.

**Fix**:
- Add slug column to `concerts` (e.g. `jimmy-carr-cirkus-2026-05-22`), backfill via migration trigger.
- New route `/event/:slug` rendering an `EventDetail` page: H1 = artist, venue + date subtitle, image, "Get tickets" button, "Add to Calendar", share buttons, back link.
- Install `react-helmet-async`; wrap app in `HelmetProvider`. Per-event `<Helmet>` sets title `"{Artist} — {Venue}, {Date} | STHLM Concerts"`, meta description, canonical, `og:image` (the event poster), and **Event JSON-LD** (`@type: MusicEvent` / `ComedyEvent`) — this is what produces Google's rich event cards.
- Homepage cards link to `/event/:slug` (still keep ticket button to outbound vendor).
- `scripts/generate-sitemap.ts` that pulls every concert and writes `public/sitemap.xml`; wire `predev` + `prebuild`.
- Update `index.html`: better title/description, remove static canonical (Helmet handles it), add `hreflang` alternate for SV.
- Update `public/llms.txt` and `robots.txt` with sitemap reference (already there).

## 2. Swedish language toggle

- Install `i18next` + `react-i18next` + `i18next-browser-languagedetector`.
- Two translation files: `src/i18n/en.json`, `src/i18n/sv.json` covering header, filter tabs, buttons, empty states, auth page, event detail labels. Concert data stays as-is (artist/venue are proper nouns).
- Language switcher (🇬🇧/🇸🇪 toggle) in header, persists to `localStorage`.
- Auto-detect from `navigator.language` on first visit (Swedish browsers → SV).

## 3. Authentication upgrades

- Enable managed Google + Apple OAuth via Lovable Cloud (one click each, no credentials needed).
- Add **Magic Link** option to `/auth` page (`supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: origin } })`).
- Keep existing email+password.
- Auth page redesign: big "Continue with Google" / "Continue with Apple" buttons on top, "or" divider, then email field with two buttons (Sign in / Send magic link), and a collapsible password section.

## 4. User-facing features on each event

- **Share buttons**: native `navigator.share()` on mobile, fallback to copy-link + WhatsApp + X buttons. Lives on event detail page + small share icon on each card.
- **Add to Google Calendar**: build a `https://calendar.google.com/calendar/render?action=TEMPLATE&...` URL from artist/venue/date. Button on event detail.

## Technical details

- **Files created**:
  `src/pages/EventDetail.tsx`, `src/components/ShareButtons.tsx`, `src/components/AddToCalendar.tsx`, `src/components/LanguageSwitcher.tsx`, `src/i18n/{index.ts,en.json,sv.json}`, `src/lib/slug.ts`, `scripts/generate-sitemap.ts`, migration adding `slug` column + backfill trigger.
- **Files edited**: `src/main.tsx` (HelmetProvider + i18n init), `src/App.tsx` (new `/event/:slug` route), `src/components/ConcertCard.tsx` (link to detail page, share icon), `src/components/Header.tsx` (language switcher), `src/pages/Auth.tsx` (Google/Apple/magic-link), `index.html` (meta), `package.json` (predev/prebuild), `src/integrations/supabase/types.ts` is auto-regenerated.
- **Packages**: `react-helmet-async`, `i18next`, `react-i18next`, `i18next-browser-languagedetector`.
- **Edge functions**: none needed.
- **Sitemap**: regenerates on each dev/build from live DB; ~hundreds of URLs.

## Out of scope (ask if you want these)
- Per-event OG image generation (uses existing `image_url`)
- PWA install
- Email digest of new shows
- Server-side rendering (current setup uses client-side Helmet — fine for Googlebot, not for Slack/LinkedIn previews of event pages)
