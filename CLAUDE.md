# Reunite — Claude Code project context

> Standing context for Claude Code. The product **soul** lives in
> [MANIFESTO.md](MANIFESTO.md) (Chinese) — read it before any decision that
> touches behavior. This file is the quick, factual orientation.

## What Reunite is

Reunite is a digital time capsule. You write a letter to your future self,
choose a day at least 15 days out, and **seal** it. The moment you seal, the
letter vanishes from the app — and on that future day it returns to you as an
email. It is a reunion across time, not a reminder app.

### The five commandments (HARD constraints — never violate)

These come from MANIFESTO.md. They are not nice-to-haves; they decide what we
will and won't build.

1. **封存即消失 / Sealing = disappearing.** The instant a letter is sealed it
   leaves the user's sight. **No list, no inbox, no count, no red badge, no
   "in transit" — ever.** The app NEVER shows you a letter you wrote. This is
   the one rule everything else bends around. A "vault you can open later" is
   just a list in disguise — forbidden.
2. **真实高于体面 / Truth over polish.** Protect the unguarded real moment.
   V1 is text only, but the architecture must not block future media
   (video / voice / photo).
3. **它必须活得比我们久 / It must outlive us.** The app's only two jobs are to
   **seal** and, on the day, to **release** the letter to somewhere the user
   owns (their email) that outlives our servers. We are never the only thread:
   the full letter text always lives in the user's own inbox.
4. **为神圣的时刻收费 / Charge for the sacred moment, not for attention.** One
   charge at sealing (which prepays that capsule's storage). No ads, no
   attention-stealing. (Not billed in the hackathon build.)
5. **小而美 / Small and beautiful.** A quiet thing, loved by a few, that pays
   for itself and lives long. The goal, not a compromise.

**Reunion happens via email + web, never inside the app.** On the delivery day
a messenger email arrives (sender shown as "You, in {year}"); it carries a link
to a crafted **web reveal page** for the slow unsealing, plus the full plain
text at the bottom as a survival copy.

## Brand

- **Name:** Reunite. **Tagline:** *Meet the person you used to be.*
- Source of truth: [BRAND.md](BRAND.md). Quiet, elegant, timeless, human.
  Never playful, never noisy, never AI-looking.
- **Colors:** Ivory `#F4EEE4` (background), Warm Brown `#5B4638` (text),
  Bordeaux Red `#7A1E1E` (primary brand), Antique Gold `#D6B26E` (accent).
  Also: Soft Brown `#6B5A4B`, Deep Burgundy `#A02C2C`, Paper Shadow `#EAE1D3`.
- **Fonts:** Cormorant Garamond (display SemiBold + body Regular).
  Brand specifies **IBM Plex Mono Medium** for timestamps/metadata.
  **Known gap:** the code dateline currently uses Courier New (iOS) /
  monospace (Android), not IBM Plex Mono — align this later.
- **UI style:** paper-first — the screen should feel like paper, not software.
  No cards, no dashboards, no gradients, no glassmorphism, no AI aesthetics,
  no productivity patterns. ~90% whitespace.

## Tech stack

- **App:** Expo SDK ~56.0.9, React Native 0.85.3, React 19.2.3,
  expo-router ~56.2.9, TypeScript ~6.0.3. Fonts via
  `@expo-google-fonts/cormorant-garamond`. Date picker via `@expo/ui`
  (`@expo/ui/community/datetime-picker`).
- **Backend:** Supabase (`@supabase/supabase-js` ^2.108.1) — Postgres +
  Auth (email OTP, one-time password code) + Row Level Security (RLS, the
  database's built-in per-row gatekeeper). Session persisted with
  `@react-native-async-storage/async-storage`.
- **Email:** Resend for transactional email (OTP now; delivery email later).
  Domain already verified. Provider wrapped behind a `sendEmail()` layer so it
  can move to Amazon SES long-term.
- **Delivery (planned):** a once-a-day cron job queries letters due today and
  not yet sent, emails them, and stamps `delivered_at` — idempotent, no
  per-letter alarms.

Pull exact versions from `apps/mobile/package.json`.

## Repo structure (monorepo)

```
dear-future-app/
  CLAUDE.md          this file
  README.md          human-facing intro
  MANIFESTO.md       product soul (Chinese) — the five commandments
  MVP-V1.md          V1 scope
  PRD.md             2-day hackathon PRD (incl. English UI copy table)
  BRAND.md           brand identity (name, colors, fonts, philosophy)
  SCRATCHPAD.md      work log — "where we left off"
  apps/mobile/       the Expo app
    AGENTS.md / CLAUDE.md   mobile-specific note (read versioned Expo 56 docs)
    src/app/index.tsx       writing screen (the whole app is ~one screen)
    src/components/SignIn.tsx        email → OTP code → verify
    src/components/AccountButton.tsx account / sign-out
    src/lib/supabase.ts             Supabase client + session config
    src/constants/rules.ts          MIN_SEAL_DAYS = 15
```

The mobile `AGENTS.md`/`CLAUDE.md` is intentionally short ("Expo has changed —
read the v56 docs first"). Keep it; this root file complements it.

## How to run

```
cd apps/mobile && npx expo start --ios
```

The first cold build with the bundled Cormorant font is slow (~20s) and Expo
Go may time out. If it does, reopen `exp://127.0.0.1:8081` or just wait.

## Conventions

- **Chinese `//` comments are intentional — keep them.** The founder is a
  learner reading along; do not strip or translate them.
- **App UI copy is ENGLISH** (Reunite is a global product). Docs are Chinese,
  UI strings are English. The English copy table is in PRD.md section 12.
- **Structural / layout RN changes often need a full Reload** — Fast Refresh
  frequently misses them. Reload before assuming a layout change didn't work.
- **A letter's owner is `auth.uid()` (stable account ID), not the email
  string.** Emails change and inboxes die; the delivery address is re-read from
  the account at send time. The client never sends `owner_id` — the database
  fills it via `default auth.uid()`, and RLS enforces
  `with check (owner_id = auth.uid())`.
- **RLS is insert-only** — no select / update / delete. The app can write a
  letter but can never read one back. This is commandment #1 expressed in SQL.
- **`MIN_SEAL_DAYS = 15` is defined once** in `src/constants/rules.ts`. Both
  the front end and (eventually) the back end validate against it. To change
  the floor, change that one line.

## Key files

- `apps/mobile/src/app/index.tsx` — the writing screen (write → pick date →
  seal; the sealed screen; "Write another").
- `apps/mobile/src/components/SignIn.tsx` — email → OTP code → verify. Note the
  code is **8 digits** (Supabase default), not 6.
- `apps/mobile/src/components/AccountButton.tsx` — account row / sign out.
- `apps/mobile/src/lib/supabase.ts` — Supabase client + session persistence.
- `apps/mobile/src/constants/rules.ts` — `MIN_SEAL_DAYS = 15` (single source).

## Known gaps / open items

See SCRATCHPAD.md for the live log. Notable: timestamp font (Courier New →
IBM Plex Mono), Android layout not yet verified, delivery cron + web reveal
page not yet built, minor date-capsule visual quirk.
