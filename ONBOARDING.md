# Onboarding plan for public sign-up

Status: proposal for review (2026-10-06). Nothing here is built yet except where a section says "today". Check the decisions in section 9, then the work in section 7 can start as separate pull requests into `develop`.

## 1. Goal

Anyone with a Google account can find PairPocket, understand what it does and what happens to their data, sign in, and record a first transaction in a few minutes, alone or with a partner, in their own language. Today only Google OAuth test users can sign in (issue #35).

## 2. Where we are today

| Area | Today | Notes |
| --- | --- | --- |
| Who can sign in | Google OAuth consent screen in **Testing**: only listed test users | No allowlist in code. Publishing the OAuth app opens sign-in to everyone at once. |
| Signed-out page | `LoginLanding`: app name, one tagline, one description, Google button, language toggle | No explanation of features, privacy, AI use or cost. Rendered on the client after a loading spinner. |
| Account creation | First Google sign-in creates `users` and `user_settings` documents | No consent record, no age or terms acceptance. |
| Setup wizard | `OnboardingWizard` (4 steps, about 2,900 lines) | Step 0: language, ledger start date, Gemini key. Step 1: banks, cards, brokerages (Canada and Korea tabs, screenshot scan). Step 2: subscriptions and fixed bills. Step 3: brokerage holdings. Progress saved on the server (`onboarding_personal_step`) and drafts in session storage. |
| Partner | Invite by email from Settings; `/[locale]/invite/[token]` accepts after sign-in | Invitation emails go through Resend. |
| Leaving | CSV export of transactions; Settings "reset data" | **No account deletion.** Reset keeps the account and settings. |
| Languages | All UI text in language packs; 10 locales registered, ko and en complete | See `docs/I18N.md`. A new language needs only a translated pack. |

Things stored per user: Google profile (name, email, picture, Google id), **Google OAuth access and refresh tokens (unused by the app)**, ledger data (transactions, accounts, subscriptions, holdings), merchant and institution lists, the Gemini API key (encrypted), AI scan logs with parsed receipt contents, audit log entries, and sign-in sessions (hashed tokens, user agent).

## 3. What blocks a public opening

| # | Gap | Why it matters | Severity |
| --- | --- | --- | --- |
| 1 | No privacy policy, terms, or consent record | Required to publish the Google OAuth app with a home page and privacy link; expected under PIPEDA (Canada) and PIPA (Korea) | Blocker |
| 2 | No way to delete an account and its data | Users must be able to leave; a privacy policy must say how | Blocker |
| 3 | Gemini free tier terms not explained | On the free tier Google may use submitted content (receipt photos) to improve its products, and humans may review it. Users bring their own key, so they must hear this before uploading | Blocker |
| 4 | Unused Google tokens stored in plain form | Data we do not need is a liability if the database leaks | High |
| 5 | No rate limits or upload size caps on AI, invitation and import endpoints | One account can exhaust Heroku memory, email quota or the database | High |
| 6 | Email sender is `onboarding@resend.dev` (default) | Resend only delivers test-domain mail to the Resend account owner; invitations to strangers fail until `pairpocket.me` is verified in Resend | High (check the production config) |
| 7 | Free-tier hosting limits | Atlas M0 has 512 MB and no backups; Heroku Eco dynos sleep; Vercel Hobby is for non-commercial use (check whether donations change that) | Medium |
| 8 | Signed-out page does not explain the product | Most visitors leave before signing in; Google's OAuth review also expects a home page that describes the app | Medium |
| 9 | Korea-and-Canada assumptions | The Korea tab appears only when Korean is a chosen language (`lib/locale-countries.ts`); issue #17 proposes per-user countries | Medium |
| 10 | PWA manifest description is English only and says "for couples" | First impression on install | Low |

## 4. Proposed experience

```
Landing (signed out)  ->  Google sign-in  ->  Welcome & consent  ->  Setup wizard  ->  Dashboard + checklist
   /[locale]                                   (new users only)        (skippable steps)
```

### 4.1 Landing page (signed out)

Replace `LoginLanding` with a real landing page. Same URL (`/[locale]`), all text from a new `landing.*` namespace, screenshots from `docs/demo`.

```
+------------------------------------------+
| [logo] PairPocket          [KO|EN v] [Sign in] |
|                                          |
|  Mine, yours, and ours, in one ledger.   |
|  Personal and shared books across        |
|  KRW and CAD, with subscriptions, stocks |
|  and receipt scanning.                   |
|  [ Continue with Google ]                |
|  Free. No bank login needed.             |
|                                          |
|  [screenshot: dashboard]                 |
+------------------------------------------+
| Who it's for                             |
|  Solo | Couples | Two-country households |
+------------------------------------------+
| What you get (cards)                     |
|  Personal + shared ledgers               |
|  KRW / CAD with live exchange rates      |
|  Subscriptions and installments          |
|  Stocks and brokerage accounts           |
|  AI receipt scan (your own Gemini key)   |
+------------------------------------------+
| How it works: 1 Sign in  2 Set up  3 Record |
+------------------------------------------+
| Your data                                |
|  What we store / what we never ask for   |
|  (no bank passwords, no card numbers)    |
|  Delete everything any time              |
+------------------------------------------+
| FAQ: cost, Gemini key, partner privacy,  |
| where data lives, languages              |
+------------------------------------------+
| Privacy | Terms | Contact | GitHub | Support |
+------------------------------------------+
```

Recommendations:

- Render the landing on the server so it shows immediately and can be indexed. The simplest route is to keep `/[locale]` as the landing page and move the signed-in app to `/[locale]/app` (PWA `start_url` becomes `/app`, and a signed-in visit to `/` jumps to `/app`). Keeping the app at `/` also works, but the page stays a client-rendered spinner first.
- Add `/[locale]/privacy` and `/[locale]/terms`. Long legal text belongs in per-language Markdown files (`content/legal/<locale>/privacy.md`) with the same fallback rule as the language packs (missing language shows English).
- Per-locale `<title>`, description and `hreflang` links come from `metadata.*` in the packs.

### 4.2 Sign-in and consent

Google sign-in stays the only method. After the first sign-in, a short **Welcome** screen appears before anything else and records consent:

```
+------------------------------------------+
| Welcome, Minsik                           |
|                                           |
| Before you start                          |
|  - Your ledger is stored on PairPocket's  |
|    database (MongoDB Atlas, <region>).    |
|  - Your partner only sees the shared      |
|    ledger, never your personal one.       |
|  - Receipt scanning sends images to Google|
|    Gemini with your own key (optional).   |
|  - You can export or delete everything.   |
|                                           |
| [x] I agree to the Terms and Privacy Policy|
| [x] I am at least <age> years old          |
|                                           |
|            [ Continue ]  [ Sign out ]     |
+------------------------------------------+
```

- Store `consent: { version, accepted_at, locale }` in `user_settings`. Bump `version` when the policy changes and show the screen again.
- Until consent exists, the API rejects data writes for that user (a small dependency next to `get_current_user`), so an old client cannot skip it.
- Existing test users see the screen once on their next visit.

### 4.3 Setup wizard

Keep the current wizard, which already works, and change its order so nothing optional blocks the first transaction:

| Step | Content | Required |
| --- | --- | --- |
| 1. Basics | Language (pre-filled from the landing page), countries you use (Canada, Korea; later per #17), ledger start date | Yes |
| 2. Accounts | Banks, cards, brokerages, cash; screenshot scan where a Gemini key exists | Skippable |
| 3. Recurring | Subscriptions, installments, fixed bills | Skippable |
| 4. Investments | Holdings; only shown when a brokerage account exists | Skippable |
| 5. Extras | Gemini key (with the free-tier notice from section 5), invite a partner now or later | Skippable |

Changes from today:

- Move the Gemini key from step 0 to the last step and explain why it is needed (scanning only) and what Google's free tier does with images.
- Add the partner invite as an optional choice instead of a Settings-only action.
- Steps 2 to 4 already scan screenshots; when no key exists, show "Add a Gemini key in Extras to scan" instead of a disabled area.
- Every step keeps the existing "skip and start" exit.

### 4.4 First session

The dashboard shows a dismissible **Getting started** card until each item is done or dismissed: add your first transaction, add an account, invite your partner, add a Gemini key, install the app (PWA). Empty states on each tab link to the matching action.

### 4.5 Invited partner

An invitee who has never signed in follows the invite link, signs in with Google, sees the Welcome screen, and then a shortened wizard (Basics only; shared start date pre-filled from the invitation) before the invitation is accepted. The invitation email uses the inviter's language today; the landing and Welcome screens follow the browser or the language picker.

## 5. Data, privacy and terms

Draft points for the privacy policy (a lawyer or a privacy template service should review the final text; this is not legal advice):

- **Collected**: Google profile (name, email, picture), ledger content you enter, account names and last four digits you type (never full card numbers or bank passwords), encrypted Gemini key, AI scan logs, sign-in session records, simple audit logs.
- **Where**: MongoDB Atlas (region of the production cluster), API on Heroku (US), frontend on Vercel, email through Resend.
- **AI**: images are sent to Google Gemini only when the user scans, using the user's own key. On Google's unpaid tier Google may use that content to improve its products and humans may review it (Gemini API Additional Terms); a paid key avoids that. PairPocket does not train models.
- **Sharing**: no selling, no ads, no third-party analytics. A linked partner sees shared ledger data only.
- **Retention and deletion**: data stays until the user deletes it. Account deletion removes personal data immediately and backups within a stated period.
- **Rights and contact**: export, correction, deletion, and a contact address.
- **Children**: a minimum age (decision in section 9).

Terms: service provided as is, not financial advice, AI results must be reviewed, acceptable use (no abuse of invitations or uploads), the right to suspend abusive accounts, and how changes are announced.

## 6. Abuse limits and capacity

| Endpoint | Proposed limit |
| --- | --- |
| AI parse and scan endpoints | 10 MB per file, 15 files per request, about 60 requests per user per hour |
| Invitations | 5 per user per day, 1 pending at a time (already) |
| CSV import | 2,000 rows per file |
| Sign-in | Rate limit the callback and session routes per IP |

Store counters in MongoDB with a TTL index so limits work across dynos. Add `SIGNUP_MODE=open|invite|closed` as a kill switch: with `closed`, existing users keep working and new Google accounts see a friendly "sign-ups are paused" page.

Capacity check before opening: Atlas storage alert at 70%, a backup plan (paid tier or a scheduled `mongodump`), Heroku dyno type that does not sleep, Resend daily quota, and the Vercel plan.

## 7. Engineering changes, in pull request order

Each line is one pull request into `develop`.

1. `fix/stop-storing-google-tokens`: stop saving Google access and refresh tokens; migration that unsets them.
2. `feat/upload-limits`: file size and count caps, MongoDB-backed rate limits, `SIGNUP_MODE`.
3. `feat/account-deletion`: `DELETE /api/account` (confirm by typing the email) that unlinks the partnership, deletes personal data and the user, and leaves shared data with the remaining partner; Settings UI in all languages.
4. `feat/consent`: consent record, Welcome screen, API guard, privacy and terms pages (Markdown per language).
5. `feat/landing-page`: server-rendered landing page, `landing.*` messages, optional move of the app to `/[locale]/app`, localized PWA manifest description.
6. `feat/onboarding-v2`: wizard order and Extras step, partner invite in the wizard, getting-started checklist, invitee short path.
7. `chore/launch-ops`: Resend domain, monitoring and backups (configuration, documented in `docs/BRANCHING.md` staging table style).

Every PR adds its text to `messages/ko.json` first, then `en.json` (`npm run check:i18n`).

## 8. Launch checklist

Google Auth Platform (Google Cloud Console):

- [ ] Branding: app name, user support email, home page `https://www.pairpocket.me`, privacy policy URL, terms URL, authorized domain `pairpocket.me` (verified in Google Search Console). Uploading a logo starts brand verification, which takes a few days.
- [ ] Data access: only `openid`, `email`, `profile` (non-sensitive, so no sensitive-scope review).
- [ ] Audience: **Publish app** (Testing to In production).
- [ ] Sign in with an account that was never a test user, finish onboarding, add a transaction, delete the account.

Other services:

- [ ] Resend: verify `pairpocket.me`, set `EMAIL_FROM=PairPocket <noreply@pairpocket.me>`, send a test invitation to an outside address.
- [ ] MongoDB Atlas: storage alerts, backups, IP access list.
- [ ] Heroku: dyno type, `SETTINGS_ENCRYPTION_KEY` set, `ALLOW_DEV_LOGIN` and `TEST_LOGIN_PASSWORD` unset.
- [ ] Staging soak on `develop` for at least a week with two test couples (Korean and English).

## 9. Decisions needed from you

1. Minimum age (common choices: 14 for Korea, 16 or 13 elsewhere) and whether to state Canada and Korea as the intended regions.
2. Contact address for privacy requests (for example `privacy@pairpocket.me`).
3. On account deletion with a linked partner: keep shared records with the partner (recommended) or delete them too.
4. Move the app to `/[locale]/app` (recommended for a fast, indexable landing page) or keep it at `/[locale]`.
5. Open sign-up fully, or start with `SIGNUP_MODE=invite` (only people invited by an existing user can join) for the first weeks.
6. Whether donations through Buy Me a Coffee are fine on the current Vercel plan, or the frontend moves to Vercel Pro or another host before opening.

## 10. How we will know it works

- Share of new sign-ins that finish the Welcome screen and the Basics step.
- Time from first sign-in to first saved transaction (target: under 5 minutes).
- Share of users who add a Gemini key, and scan success rate (from `ocr_logs`).
- Week-1 retention, split by language and by solo versus couple.
