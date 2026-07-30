# PairPocket

> "A budget is telling your money where to go instead of wondering where it went."
> — John C. Maxwell

[![Live demo](https://img.shields.io/badge/Live-pair--pocket.vercel.app-2563eb?style=flat-square)](https://pair-pocket.vercel.app/en)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-FFDD00?style=flat-square&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/minsikpaul92)

A dual-currency household ledger anyone can use: personal and shared books, subscriptions and stocks in one place, with AI screenshot import tuned so scanned numbers stay trustworthy.

**Live app:** [https://pair-pocket.vercel.app/en](https://pair-pocket.vercel.app/en)

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

Switch context instantly. Shared data is scoped by partnership; personal data never leaks to the partner. Solo use stays on the personal ledger.

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
