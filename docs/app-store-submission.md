# App Store Submission Kit — Reunite

Ready-to-paste copy and a checklist for the App Store Connect "1.0 Prepare for
Submission" page. All store copy is English (global product). Voice: quiet,
elegant, timeless, human — never salesy.

App name (already set, 30/30 chars): **Reunite: Letters to Future You**
Bundle ID: com.stillkindailab.reunite · ASC App ID: 6782853400

---

## 1. App Store listing (Distribution → iOS App 1.0)

### Subtitle (max 30 chars)
```
Meet the person you used to be
```

### Promotional Text (max 170 chars — editable anytime without review)
```
Write a letter to your future self, choose a day, and seal it. It disappears today — and returns to you by email on the very day you chose. A reunion across time.
```

### Description (max 4000 chars)
```
Reunite is a quiet place to write to your future self.

Write a letter to the person you'll be — in one year, in five, in twenty-five. Choose the day it should arrive. Then seal it.

The moment you seal a letter, it disappears. No inbox. No list. No countdown. The letter leaves your hands completely, and waits.

On the day you chose, it comes back — not inside the app, but as an email from "You, in [year]," carrying everything you wrote, to read slowly, wherever you are.

That is the whole idea. No feeds. No streaks. No notifications begging for your attention. Just one honest letter, written today, opened by the person you become.

WHY REUNITE IS DIFFERENT
• Sealing means disappearing. Once a letter is sealed, the app never shows it to you again — the surprise is the point.
• It outlives the app. Every letter is delivered to your own email, somewhere you own and keep.
• Words, photos, and a short video. Hold on to the real moment, not a polished one.
• Quiet by design. No ads, no algorithms, no reasons to come back tomorrow.

HOW IT WORKS
1. Write your letter.
2. Choose a day, at least 15 days away.
3. Seal it — and let it go.
4. On the day, it arrives in your inbox.

Reunite is for anyone who has ever wondered what they would say to their future self — and what their past self would say back.

Meet the person you used to be.
```

### Keywords (max 100 chars, comma-separated, no spaces after commas)
```
time capsule,future self,diary,journal,memory,reflection,mindfulness,self care,keepsake,write
```

### Support URL (required — must be a reachable https page)
```
https://dear-future-app.vercel.app/support
```
> LIVE NOW (curl-verified 200). A dedicated support page with a contact email +
> FAQ. After you attach the custom domain you can switch this to
> https://dearfuture.space/support. IMPORTANT: make sure the contact mailbox on
> that page (privacy@dearfuture.space) actually receives mail — or change it to
> an email you monitor.

### Marketing URL (optional)
```
https://dear-future-app.vercel.app
```

### Copyright
```
2026 Shanghai Youzhuoqu Cultural Innovation Co., Ltd.
```

### Version
```
1.0
```

---

## 2. App Information (General → App Information)

### Privacy Policy URL (REQUIRED)
```
https://dear-future-app.vercel.app/privacy
```
> LIVE NOW (curl-verified 200, assets load). After attaching the custom domain
> you can switch to https://dearfuture.space/privacy. TODO: set the real
> "Effective date" on the privacy page before submitting.

### Category
- Primary: **Lifestyle**
- Secondary: **Productivity** (optional)

### Content Rights
- Does it contain third-party content? **No**.

---

## 3. Age Rating (App Information → Age Rating)
Answer the questionnaire. For Reunite, letters/photos are private to the author
and delivered only to their own email — this is NOT social/shared user content,
so the UGC concerns do not apply. Expected answers:
- All violence / sexual / profanity / drugs / gambling / horror categories: **None**
- Unrestricted web access: **No**
- User-generated content shared with others: **No** (content is private to the
  author, delivered to their own inbox)
→ Expected rating: **4+**

---

## 4. App Review Information (General → App Review)  ★ MOST IMPORTANT ★

### Sign-in problem (must solve before submitting)
The app logs in with a passwordless email code (OTP). A reviewer cannot receive
that code. Fix: in Supabase → Authentication → set a **test email with a fixed
OTP code** (Supabase supports preset test OTPs), then give Apple that email +
code below. Without this, the reviewer is stuck at login → instant rejection.

- Demo account email:  `review@dearfuture.space`  (or any address you set as a test OTP)
- Fixed OTP code:       `123456`  (set this in Supabase test-OTP settings)
- Sign-in required:     Yes

### Review Notes (paste — explains the disappearing model + how to test)
```
Thank you for reviewing Reunite.

ABOUT THE APP
Reunite is a time capsule for letters to your future self. By design, the moment a letter is sealed it disappears from the app — there is intentionally no inbox, list, or history of sealed letters. This is the core concept, not a bug. A sealed letter is delivered later as an email to the user's own address on the future date they chose (minimum 15 days out). On-day delivery is handled by a daily server job, so it cannot be observed during review; the sealing flow itself is fully testable.

SIGNING IN (passwordless)
Login uses a one-time email code. Please use this test account, which has a fixed code:
  Email: review@dearfuture.space
  Code:  123456
Enter the email, tap continue, then enter the code above.

HOW TO TEST
1. On the opening screen, tap "Start".
2. Write any text in the letter.
3. (Optional) add up to a few photos or a short video.
4. Tap to seal; choose a delivery date at least 15 days ahead.
5. Complete the purchase (see below). After sealing, the letter disappears — this is expected.

IN-APP PURCHASES
Sealing a letter is a one-time consumable purchase (three tiers by media amount: Words; Words & Photos; Words, Photos & Video). Please test in the sandbox environment.

Thank you — we're happy to answer any questions.
```

### Contact information
- First / Last name: Dan Deng (use your real name)
- Phone + email: your real reachable contact
- Notes: keep the demo account valid until review is complete.

---

## 5. App Privacy (Trust & Safety → App Privacy)
Declare the data the app collects:
- **Contact Info → Email Address** — Used for: App Functionality (account +
  letter delivery). Linked to the user: Yes. Used for tracking: No.
- **User Content → Other User Content** (the letters, photos, video) — Used for:
  App Functionality. Linked to the user: Yes. Used for tracking: No.
- **Identifiers** — only if RevenueCat/analytics require it; for purchases,
  declare **Purchases → Purchase History**, App Functionality, not for tracking.
- Tracking (ATT): **No** — the app does not track across other apps/sites.

---

## 6. In-App Purchases (Monetization → In-App Purchases)
Create 3 **Consumable** products (must match the IDs the app expects). Each needs
a display name, description, price, and a review screenshot. Submit them together
with the app version (attach in the version's "In-App Purchases" section).

| Product ID            | Reference Name        | Display Name              | Description |
|-----------------------|-----------------------|---------------------------|-------------|
| reunite.seal.words    | Seal — Words          | Words                     | Seal a letter of words to your future self. |
| reunite.seal.photos   | Seal — Words & Photos | Words & Photos            | Seal a letter with words, up to 4 photos and a short video. |
| reunite.seal.video    | Seal — Photos & Video | Words, Photos & Video     | Seal a letter with words, up to 10 photos and a longer video. |

> The app reads these via RevenueCat Offerings; the RevenueCat Offering must have
> packages named exactly `words`, `photos`, `video` mapped to these product IDs.

---

## 7. Screenshots (required — at least 1, up to 10)
Apple needs **6.5" iPhone** screenshots (1284 × 2778 px) — one set covers all
sizes. Only the first 3 show on the install sheet, so order them best-first.

Recommended 3–5, captured from the iPhone (or the iOS Simulator, Cmd+S):
1. Opening screen (Reunite seal + "Meet the person you used to be" + Start).
2. The writing screen with a heartfelt letter typed in.
3. Choosing the delivery date (the calendar).
4. The "sealed" screen — the quiet confirmation after sealing.
5. (Optional) a letter with a photo attached.

> Tip: take them on the device at the right resolution, or in the iPhone 15/16
> Plus simulator. Keep them clean and calm — no marketing banners.

---

## OUTSTANDING ITEMS (what is still needed before you can submit)
1. ☐ Verify build 3 launches past "Start" on device (in progress).
2. ☐ Deploy the web so the **Privacy Policy URL** and **Support URL** are live.
3. ☐ Set up the **test-OTP demo account** in Supabase (review@…, fixed code) and
      put it in the Review Notes above.
4. ☐ Create the **3 IAP products** in App Store Connect and attach to version 1.0.
5. ☐ Capture and upload **screenshots** (6.5").
6. ☐ Fill **App Privacy** questionnaire + **Age Rating**.
7. ☐ App icon: confirm the 1024×1024 marketing icon has **no alpha/transparency**
      (the earlier ITMS-90863 email was about Mac symbols, separate — but check
      the icon has no alpha to avoid an upload warning).
```
