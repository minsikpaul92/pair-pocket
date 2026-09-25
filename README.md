# PairPocket

> "A budget is telling your money where to go instead of wondering where it went."
> — John C. Maxwell

[![Live demo](https://img.shields.io/badge/Live-www.pairpocket.me-2563eb?style=flat-square)](https://www.pairpocket.me/en)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-FFDD00?style=flat-square&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/minsikpaul92)

A dual-currency household ledger anyone can use: personal and shared books, subscriptions and stocks in one place, with AI screenshot import tuned so scanned numbers stay trustworthy.

**Live app:** [PairPocket](https://www.pairpocket.me/en)

<a href="https://buymeacoffee.com/minsikpaul92" target="_blank" rel="noopener noreferrer">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="180" />
</a>

---

## Why I built this

I immigrated to Canada and still hold assets in more than one country. Existing money apps were either built for a single local market or too shallow for how a couple actually lives: mine, yours, and ours, across currencies, banks, subscriptions, and brokerage accounts.

I could not find a couple-ready product that kept **personal** ledgers private while syncing a **shared** household book, and still covered the detail I needed (subscriptions, stocks, onboarding without guessing where to start). So I built PairPocket end-to-end as a production PWA.

That origin story is personal, but **the app is not limited to couples or immigrants**. Solo users can run a full personal ledger (including subscriptions and stocks). Sharing with a partner is optional when you want a household book.

What matters most in practice:

- **One place for the whole picture** — shared household ledger plus personal ledgers, personal subscriptions, and personal stocks, without mixing private data into the partner view.
- **AI screenshot fill with careful prompting** — brokerage and setup screens become structured fields. The hard part is not “call an OCR API”; it is prompt engineering so tickers, quantities, and balances do not get inventively wrong.
- **Low-friction start** — first-time and couple setup can lean on AI instead of a blank spreadsheet. You bring your own Gemini key; the app does not force a paid AI plan to try the flow.
- **Depth over generic finance UI** — many apps show balances; fewer ship the dual-ledger rules, invite + shared start date, and import paths this life actually needs.

Today the product is tuned for **KRW / CAD** (Korea–Canada). The same pattern applies to many people managing money across borders; expanding currency and country support is on the roadmap, along with stronger daily stock price refresh.

---

## Demo

### Personal ↔ Shared ledger toggle

Switch between personal and shared ledgers. Solo use stays on the personal ledger. Strengthening privacy boundaries and preserving historical partnership scopes are priorities in the roadmap below.

![Personal and Shared toggle](docs/demo/01-personal-shared-toggle.gif)

### Add a transaction

Quick entry with the shared day picker and floating actions (camera for scan, plus for manual entry).

![New transaction flow](docs/demo/02-new-transaction.gif)

### Invite a partner

Optional: send a Google-email invite with a **shared ledger start date** so both sides align from day one.

![Partner invite modal](docs/demo/03-partner-invite.jpg)

### AI screenshot fill (stocks / onboarding)

Upload brokerage (or onboarding) screenshots; Gemini fills structured fields with prompt-tuned parsing so tickers and balances stay accurate.

![AI screenshot scan](docs/demo/04-ai-scan.gif)

---

## Highlights (for reviewers)

| Area | What shipped |
|------|----------------|
| Auth | Google OAuth (Authlib) + app JWT, invite accept while logged out / logged in |
| Dual ledger | `personal` vs `shared` with group-scoped queries (`shared_group_id`); solo-friendly |
| Multi-currency | CAD / KRW / ALL with FX for combined views |
| Product surface | Calendar, list, dashboard analytics, subscriptions, stocks, smart import |
| AI | Prompt-tuned screenshot parse, user Gemini key, model fallback chain, partner key borrow / share |
| Mobile | PWA, safe-area chrome, Apple HIG-inspired Tailwind UI (light / dark) |
| Deploy | Frontend on **Vercel**, API on **Heroku**, MongoDB Atlas |

Specs: [`PRD.md`](./PRD.md) · Design: [`design.md`](./design.md)

---

## Improvement roadmap

This is the planned work, ordered by priority. Unchecked items are not completed or guaranteed by the current release. The first phase addresses review findings and reported reliability problems before expanding analysis features.

### Phase 1 — Privacy, data integrity, and reliability

- [ ] **Protect linked transactions.** Make transaction relationships server-managed. Verify ownership, ledger access, and the reciprocal relationship before updating or deleting a linked entry. Add regression tests proving that one user cannot mutate another user's unrelated transactions.
- [ ] **Keep personal history out of shared suggestions.** Apply the ledger scope to merchant, institution, and category lookups as well as transaction lists. Verify that shared autocomplete never includes a partner's personal history.
- [ ] **Preserve historical partnership boundaries.** Store a stable shared-ledger/group ID on shared records and authorize access against that group. Define access after unlinking, and migrate existing records with a dry run and backup. Do not assign ambiguous historical records to a new partnership automatically. Test unlinking and linking to a different partner.
- [ ] **Make invitations and paired writes atomic.** Use conditional updates and database transactions where supported to prevent concurrent invitation acceptance and partial writes. Creating, editing, or deleting shared funding must leave both sides consistent, including converting an ordinary transaction into shared funding. Verify failure and retry behavior.
- [ ] **Validate settlements consistently.** Require matching currency, ledger scope, and access to the original expense. Prevent over-settlement under concurrent requests and reject edits that invalidate existing settlements. Test remaining amounts and account balances after each operation.
- [ ] **Keep sessions signed in reliably.** Investigate token expiry, browser storage, and authentication error handling; the current access token lifetime is seven days. Implement renewable sessions with rotating, revocable refresh credentials and protected cookie handling suitable for the deployed frontend/API domains. Retry authentication once after refresh, keep network failures separate from expired sessions, and preserve drafts if sign-in is required.
- [ ] **Preserve input and explain failures.** Close or clear a form only after confirmed save success. Retain drafts after failed saves, prevent duplicate submissions, and show actionable English/Korean messages for missing fields, invalid account/currency combinations, expired sessions, and server failures. Isolate any persisted drafts by user and clear sensitive drafts on logout. Distinguish failed loading from an empty ledger and provide retry controls.
- [ ] **Add core regression coverage.** Cover authorization, partnership changes, settlements, paired transfers, balances, session renewal, and failed-save recovery. Run relevant backend tests and frontend type/build checks in CI before merging behavioral changes.

### Phase 2 — Import workflows and a consistent experience

- [ ] **Process multiple receipt images.** Support selecting multiple files, show progress and a separate review result for each receipt, and allow users to group images belonging to the same receipt. Preserve successful results when another receipt fails. Save reviewed receipts individually or as a batch, track saved/failed states, and retry only failed entries without duplicates.
- [ ] **Import monthly card-statement PDFs with duplicate review.** Extract and normalize statement rows, then compare them with existing transactions using the account, currency, amount, transaction/posting dates, and normalized merchant. Label rows as new, likely duplicate, or requiring review. Do not silently discard legitimate repeated purchases. Use import identifiers to make retries safe and let users confirm which new rows to save.
- [ ] **Unify Korean and English layouts.** Use the Korean layout as the structural baseline for both languages and countries. Separate language preference from country, currency, and account settings; move language switching into Settings. Keep controls, navigation, and feature availability consistent while allowing translated text to wrap naturally. Check both languages at mobile and desktop widths.
- [ ] **Add release notes to Settings.** Maintain versioned English/Korean entries with a date and sections for additions, improvements, and fixes. Display the current version and release history in Settings. Update these entries as part of each release; planned work must not appear as shipped.
- [ ] **Explain the app before sign-in.** Add a public introduction page covering who the app is for, personal versus shared ledgers, supported currencies, subscriptions, stocks, receipt imports, privacy, Gemini key requirements, and the steps to get started. Use examples and screenshots with a clear Google sign-in action. Keep this introduction separate from the existing post-login account setup and describe only available features as available.

### Phase 3 — Spending detail and budgets

- [ ] **Add weekly spending analysis.** Provide weekly totals, a weekly trend, and previous-week comparisons in the dashboard. Define one week-boundary and user-timezone policy, label partial weeks, and handle weeks crossing month/year boundaries consistently. Reuse existing settlement and transfer rules so weekly and monthly totals reconcile.
- [ ] **Browse item-level subcategories.** Introduce a clear hierarchy of category, subcategory, and item group; keep merchant as a separate dimension. Preserve raw receipt descriptions and add normalized item names, quantities, units, and group IDs. Let Gemini suggest reusable groups and let users correct assignments. Support filtering and totals at all three levels without double-counting receipt items and their parent transaction; account for taxes, tips, and discounts explicitly.
- [ ] **Recognize custom categories in Gemini imports.** Include the user's current allowed categories, subcategories, descriptions, and relevant corrections in each classification request. Validate returned category IDs on the server and flag uncertain assignments for review. Offer explicit reclassification of historical items. Adding a category updates the supplied context; it does not automatically train Gemini.
- [ ] **Set monthly budgets and explain spending.** Support personal/shared budgets with a defined currency, a monthly total, and category allocations. Calculate actual spending, remaining budget, pacing, and projected month-end spending in application code. Explain overspending and practical savings opportunities with Gemini using those verified totals. Separate recurring commitments and transfers appropriately, and make exchange-rate assumptions visible for combined-currency views.

### Phase 4 — Evidence-based comparisons and shopping advice

- [ ] **Compare with relevant households and personal goals.** Collect optional region, age band, occupation, gender, and household size, with clear consent for AI use and controls to edit/delete the profile. Start with the user's budget, spending history, income, assets, and savings goals. Add external peer comparisons only when credible statistics support them; show the source, year, geography, household definition, and limitations. Broaden the comparison group or state that data is unavailable when an exact group such as “Toronto students in their mid-30s” is unsupported. Averages are context, not a verdict on an individual household.
- [ ] **Compare shopping unit prices.** Start with the user's own receipts. Normalize price per kilogram, liter, or item and compare equivalent products, accounting for package size, product cut/type, discounts, and purchase date. Show the receipts supporting each suggestion. Add external store prices only through an available, permitted, sufficiently current data source; Gemini must not invent current Metro/Costco prices or claim that a past price is available today.

### Delivery and acceptance

All phases are feasible as application work. External demographic benchmarks and current store-price recommendations depend on suitable data sources; Gemini alone cannot supply verified averages or live prices.

For each completed item:

1. Define the expected behavior and data/API changes before implementation.
2. Include migration and recovery steps when stored data changes.
3. Validate the affected paths, including personal/shared boundaries and English/Korean behavior where relevant.
4. Update release notes and check off the roadmap item only after its acceptance checks pass and it ships.

### Branch and pull request plan

Use `main` as the release branch and short-lived `docs/`, `fix/`, and `feat/` branches for focused changes. The branch names below are proposed work units, not claims that implementation already exists.

| Order | Branch | Scope |
| --- | --- | --- |
| 0 | `docs/roadmap` | Live URL and this English implementation roadmap |
| 1 | `fix/ledger-access` | Linked-entry authorization and private lookup isolation |
| 2 | `fix/partnership-scope` | Historical group scoping, migration, and invitation consistency |
| 3 | `fix/ledger-integrity` | Atomic paired writes and settlement validation |
| 4 | `fix/session-persistence` | Session diagnosis, renewal, and expiry recovery |
| 5 | `fix/save-recovery` | Draft preservation, readable errors, and safe retries |
| 6 | `feat/receipt-batches` | Multiple-receipt review and partial-failure recovery |
| 7 | `feat/statement-import` | PDF transaction import and duplicate review |
| 8 | `feat/unified-layout` | Shared layout and Settings-only language preference |
| 9 | `feat/release-notes` | Versioned release history in Settings |
| 10 | `feat/public-introduction` | Product explanation before sign-in |
| 11 | `feat/weekly-spending` | Weekly dashboard analysis |
| 12 | `feat/item-classification` | Item groups and custom-category AI context |
| 13 | `feat/monthly-budgets` | Budgets, pacing, and grounded AI explanations |
| 14 | `feat/peer-comparisons` | Optional profile and sourced benchmarks |
| 15 | `feat/unit-price-insights` | Receipt-based unit prices and shopping advice |

Start each independent change from the latest `main`. Merge prerequisite data/model changes before starting dependent work, or explicitly use a dependent PR while its prerequisite is under review. Avoid putting the whole roadmap into one branch. Each PR should explain the problem, resulting behavior, verification, and any migration requirements. Push the branch to `origin`, open a PR into `main`, and merge after review and required checks. Enable appropriate branch protection in GitHub if it is not already configured.

---

## Architecture

```
pair-pocket/
├── frontend/   # Next.js 15 App Router, next-intl, Tailwind, PWA
└── backend/    # FastAPI, Motor (async MongoDB), Authlib OAuth
```

| Layer    | Stack |
|----------|--------|
| Frontend | Next.js (App Router), React, Tailwind CSS, `@ducanh2912/next-pwa`, next-intl |
| Backend  | FastAPI, Pydantic, Motor |
| Data     | MongoDB Atlas |
| AI       | Google Gemini (user API key, encrypted at rest) |
| Hosting  | Vercel + Heroku |

---

## Tech Stack (detail)

Same as the table above. Local setup needs Node 18+, Python 3.11+, and a MongoDB URI.

## Getting Started

### 1. Backend (FastAPI)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # then edit with MongoDB + Google OAuth secrets
uvicorn app.main:app --reload
```

- API docs: http://localhost:8000/docs
- Health: http://localhost:8000/

### 2. Frontend (Next.js)

```bash
cd frontend
npm install
cp .env.example .env.local       # NEXT_PUBLIC_API_BASE_URL → backend
npm run dev
```

- App: http://localhost:3000

> **PWA note:** `next-pwa` is disabled in development. For installable PWA testing: `npm run build && npm run start`.

## Environment Variables

| Location              | Variable                   | Description                                    |
| --------------------- | -------------------------- | ---------------------------------------------- |
| `backend/.env`        | `MONGODB_URI`              | MongoDB connection string                      |
| `backend/.env`        | `MONGODB_DB_NAME`          | Database name (default: `pairpocket`)          |
| `backend/.env`        | `CORS_ORIGINS`             | Comma-separated allowed frontend origins       |
| `backend/.env`        | `SECRET_KEY`               | JWT + OAuth session secret                     |
| `backend/.env`        | `GOOGLE_CLIENT_ID`         | Google OAuth 2.0 Client ID                     |
| `backend/.env`        | `GOOGLE_CLIENT_SECRET`     | Google OAuth 2.0 Client Secret                 |
| `backend/.env`        | `OAUTH_REDIRECT_URI`       | Must match the URI registered in GCP           |
| `backend/.env`        | `FRONTEND_URL`             | Post-login redirect target                     |
| `frontend/.env.local` | `NEXT_PUBLIC_API_BASE_URL` | FastAPI base URL                               |

## Google OAuth Setup (Google Cloud Console)

The login flow is backend-driven (Authorization Code Flow via Authlib).

1. Create/select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. **OAuth consent screen** (External). Add test users while unpublished.
3. **Credentials → OAuth client ID** (Web application).
   - Authorized redirect URI example (local): `http://localhost:8000/api/auth/callback`
4. Copy Client ID / Secret into `backend/.env` and set:

   ```env
   OAUTH_REDIRECT_URI=http://localhost:8000/api/auth/callback
   FRONTEND_URL=http://localhost:3000
   ```

5. Generate `SECRET_KEY`:

   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```

### Auth endpoints

- `GET /api/auth/login` — start Google OAuth
- `GET /api/auth/callback` — OAuth redirect (issues JWT)
- `GET /api/auth/me` — current user (`Authorization: Bearer <token>`)

## Support

If PairPocket saves you time, you can [buy me a coffee](https://buymeacoffee.com/minsikpaul92). Optional, no ads in the app.

## License

See [LICENSE](./LICENSE).
