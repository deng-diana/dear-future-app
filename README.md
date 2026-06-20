# Reunite

> *Meet the person you used to be.*

Reunite is a digital time capsule.

You write a letter to your future self, choose a day far enough away that
you'll forget it, and seal it. The moment you seal, the letter disappears —
no list, no inbox, no count, no red badge. There is nothing to come back to.

Then, on a day you've long forgotten, it returns to you as an email: a quiet
reunion with the person you were when you wrote it.

> Some things are not meant to be remembered.
> They are meant to return.

What you really send isn't a letter. It's the version of yourself that time
almost erased — and the letter is only the container.

## Status

An early build. The writing-and-sealing loop works; delivery and the web
reveal page are still to come. See [SCRATCHPAD.md](SCRATCHPAD.md) for the
running log of where we are.

## Tech

- **App:** Expo SDK 56, React Native, expo-router, TypeScript
- **Backend:** Supabase — Postgres, email OTP auth, Row Level Security
- **Email:** Resend

## Getting started

```
cd apps/mobile
npx expo start --ios
```

The first cold build bundles the display font and can take ~20 seconds; if
Expo Go times out, reopen `exp://127.0.0.1:8081` or wait a moment.

## The documents

The thinking behind Reunite lives in a few short files at the root:

- **[MANIFESTO.md](MANIFESTO.md)** — the product's soul: the five things we
  will never betray (written before any code).
- **[MVP-V1.md](MVP-V1.md)** — what V1 actually is.
- **[PRD.md](PRD.md)** — the two-day build plan and the exact UI wording.
- **[BRAND.md](BRAND.md)** — name, voice, colors, and type.

---

*In the app you seal; in the world you unseal. The app never shows you a
letter — that is the whole point.*
