# PairPocket

A custom dual-wallet built by a couple who panicked at Canadian prices. Tracking our KRW & CAD survival in the Maple Country!

PairPocket is an AI-powered, dual-currency (KRW/CAD) expense tracker for a couple managing **shared** and **personal** finances. See [`PRD.md`](./PRD.md) for the product spec and [`design.md`](./design.md) for the Apple HIG-inspired design guide.

## Tech Stack

| Layer     | Technology                                              |
| --------- | ------------------------------------------------------- |
| Frontend  | Next.js (App Router), React, Tailwind CSS, @ducanh2912/next-pwa |
| Backend   | FastAPI (Python), Motor (async MongoDB driver)          |
| Database  | MongoDB (Atlas)                                         |

## Project Structure

```
pair-pocket/
├── frontend/   # Next.js (App Router) PWA
└── backend/    # FastAPI + MongoDB API
```

## Prerequisites

- Node.js 18+ and npm
- Python 3.11+
- A MongoDB instance (local, or a MongoDB Atlas connection string)

## Getting Started

### 1. Backend (FastAPI)

```bash
cd backend

# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env             # then edit .env with your MongoDB URI

# Run the dev server (http://localhost:8000)
uvicorn app.main:app --reload
```

- API docs (Swagger UI): http://localhost:8000/docs
- Health check: http://localhost:8000/
- Transactions endpoint: http://localhost:8000/api/transactions

### 2. Frontend (Next.js)

```bash
cd frontend

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env.local       # points to the backend base URL

# Run the dev server (http://localhost:3000)
npm run dev
```

> **PWA note:** `next-pwa` is disabled in development to avoid service-worker caching while iterating. To test the installable PWA, run a production build:
>
> ```bash
> npm run build && npm run start
> ```
>
> App icons are referenced from `frontend/public/icons/` (`icon-192x192.png`, `icon-512x512.png`). Add these files to enable full "Add to Home Screen" support.

## Environment Variables

| Location              | Variable                   | Description                                       |
| --------------------- | -------------------------- | ------------------------------------------------- |
| `backend/.env`        | `MONGODB_URI`              | MongoDB connection string                         |
| `backend/.env`        | `MONGODB_DB_NAME`          | Database name (default: `pairpocket`)             |
| `backend/.env`        | `CORS_ORIGINS`             | Comma-separated allowed frontend origins          |
| `backend/.env`        | `SECRET_KEY`               | Secret for signing the app JWT + OAuth session    |
| `backend/.env`        | `GOOGLE_CLIENT_ID`         | Google OAuth 2.0 Client ID                        |
| `backend/.env`        | `GOOGLE_CLIENT_SECRET`     | Google OAuth 2.0 Client Secret                    |
| `backend/.env`        | `OAUTH_REDIRECT_URI`       | Must match the redirect URI registered in GCP     |
| `backend/.env`        | `FRONTEND_URL`             | Where the backend redirects after login           |
| `frontend/.env.local` | `NEXT_PUBLIC_API_BASE_URL` | Base URL of the FastAPI backend                   |

## Google OAuth Setup (Google Cloud Console)

The login flow is backend-driven (Authorization Code Flow via Authlib). Follow these
steps to obtain a **Client ID** and **Client Secret**:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create (or select) a project.
2. **APIs & Services → OAuth consent screen**
   - User type: **External**
   - Fill in the app name, support email, and developer contact.
   - Under **Test users**, add the Google accounts that will log in (e.g. Paul & Lucy) while the app is unpublished.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized redirect URIs**: add `http://localhost:8000/api/auth/callback`
     (this must exactly match `OAUTH_REDIRECT_URI`).
4. Copy the generated **Client ID** and **Client Secret** into `backend/.env`:

   ```env
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxxxxxx
   OAUTH_REDIRECT_URI=http://localhost:8000/api/auth/callback
   FRONTEND_URL=http://localhost:3000
   ```

5. Generate a `SECRET_KEY` and add it too:

   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```

Then restart the backend. Visiting the frontend and clicking **"Google로 로그인"**
redirects to Google → back to `/auth/callback` with an app JWT → stored in the browser.

### Auth endpoints

- `GET /api/auth/login` — start the Google OAuth flow
- `GET /api/auth/callback` — OAuth redirect target (issues the JWT)
- `GET /api/auth/me` — return the current user (requires `Authorization: Bearer <token>`)
