# Product Requirements Document (PRD) : PairPocket

> **Last updated:** 2026-07-10 — P0 Shared Ledger + Invitation implemented.

## 1. Project Overview
* **Project Name:** PairPocket
* **Description:** A custom AI-powered dual-currency (KRW/CAD) expense tracker built for an immigrant couple in Canada to manage shared and personal finances seamlessly.
* **Target Users:** Paul and Lucy (A couple needing real-time shared asset management).
* **Design System:** Apple HIG (Refer to `design.md` for details). Maintain an intuitive and minimal UI.

## 2. Tech Stack
* **Frontend:** Next.js (App Router), React, Tailwind CSS, Lucide React (Icons), next-intl (i18n), @ducanh2912/next-pwa
* **Backend:** FastAPI (Python), Motor (async MongoDB)
* **Database:** MongoDB (Atlas)
* **AI & Data Analysis (planned):**
  * Text & PDF Analysis: Groq API (Gemma model) + pdfplumber
  * Image OCR (Receipts): Google Gemini 1.5 Flash API (Optimized for batch processing)
  * Stock Data: yfinance (Daily updates)
* **Infrastructure:** Vercel (Frontend), Heroku (Backend), PWA (Progressive Web App), GitHub Actions (subscription reminder cron)

## 3. Core Features (MVP)

### A. Account & Ledger Management
* **Google OAuth Login:** Simple sign-up and login via Google accounts.
* **Invitation System:** Email invitation to link two users into a single Shared Group.
* **Dual Ledger System:**
  * `Shared Ledger`: Read/Write access for both users, real-time synchronization.
  * `Personal Ledger`: Read/Write access only for the individual owner, completely hidden from the partner.
* **Multi-Currency Support:** All transactions must be categorized and stored as either `KRW` or `CAD`.

### B. Input Methods
* **App UI:** Intuitive manual input form featuring auto-completion for recently used merchants and frequent categories.
* **AI Auto-Input (PDF/Photo):**
  * Extract date, amount, currency, and merchant automatically from credit card statement PDFs or receipt images.
* **PC Bulk Upload:** Support CSV file uploads via the web interface for fast, bulk data entry.

### C. Advanced Dashboard & Analytics
* **Total Net Worth:** Track the combined total assets (Cash, Stocks, and Overall Total).
* **Dynamic Filtering:**
  * By Currency: CAD Only, KRW Only, Total (Applying exchange rates).
  * By Ownership: Shared Only, Personal Only, Shared + Personal.
* **Charts:** Monthly expense ratio (Pie Chart) and Quarterly/Bi-annual/Annual trends (Bar/Line Chart).

## 4. Database Schema Guidelines (MongoDB)
* `users`: User information, OAuth tokens, and associated `shared_group_id`.
* `transactions`: Unified storage for all transaction records.
  * Required fields: `date`, `amount`, `currency` (KRW/CAD), `type` (income/expense), `account_type` (shared/personal), `category`, `merchant`, `owner_id`.
* `accounts`: Financial accounts (checking, savings, credit card, investment, cash) with balances and institution metadata.
* `user_settings`: Array lists for custom categories, institutions, and auto-complete merchant data.
* `subscriptions`: Recurring bills and installment plans (billing cycle, promo pricing, reminders).
* `subscription_occurrences`: Per-due-date billing events linked to subscriptions and materialized transactions.
* `invitations`: Partner invite tokens (`inviter_id`, `invitee_email`, `token`, `status`, expiry).

## 5. Development Phases

### Phase 1: Foundation & Auth — ~95% complete
| Item | Status |
|------|--------|
| Next.js PWA scaffolding (`next-pwa`, manifest, Apple Web App meta) | Done |
| FastAPI + MongoDB (Motor, lifespan) | Done |
| Google OAuth login (Authlib, JWT, `/auth/callback`) | Done |
| DB schema for `account_type` and `shared_group_id` fields | Done |
| Email invitation system | Done — `/api/invitations` + InviteModal + `/invite/[token]` |
| Shared Group linking logic | Done — accept sets shared `shared_group_id` (max 2) |

### Phase 2: Core Ledger & UI — ~95% complete
| Item | Status |
|------|--------|
| Manual transaction input UI (`TransactionModal`, design.md) | Done |
| Transaction list (`ListView`) and calendar (`CalendarView`) | Done |
| Merchant / institution auto-complete | Done |
| CAD / KRW / ALL currency filter tabs | Done |
| Category presets + custom categories | Done |
| Shared / Personal view toggle | Done — header toggle next to currency filter |
| Financial accounts + net worth (`AccountRegisterModal`, `DashboardView`) | Done (beyond original PRD) |
| Asset transfers, card repayment, investment deposits | Done (beyond original PRD) |
| N-way settlement / refund (`정산` category) | Done (beyond original PRD) |
| ko/en i18n (`next-intl`) | Done (beyond original PRD) |

### Phase 3: AI Integration & Batch Upload — 0% complete
| Item | Status |
|------|--------|
| Groq (Gemma) + pdfplumber integration | Not started |
| Gemini 1.5 Flash OCR | Not started |
| PDF auto-extraction API | Not started |
| Batch receipt image upload (single Gemini batch request) | Not started |
| CSV bulk upload | Not started |

### Phase 4: Dashboard & Stocks — ~70% complete
| Item | Status |
|------|--------|
| Exchange-rate conversion for ALL view (Frankfurter API + cache) | Done |
| Net worth summary widget (account balances) | Done |
| Stats API (`/api/stats/summary` — monthly flow, category breakdown) | Done |
| Recharts Pie / Bar charts on Dashboard | Done — expense mix pie + 3/6/12 month income·expense trend |
| Category breakdown UI | Done — list beside pie from `expense_breakdown_by_category` |
| yfinance + daily stock price scheduler | Deferred — separate Stocks tab / PR |
| Full "Cash + Stocks" net worth | Deferred — with Stocks tab |

### Phase 2.5: Subscriptions & Installments — ~85% complete (not in original PRD)
| Item | Status |
|------|--------|
| Subscription CRUD (monthly / yearly / installment) | Done |
| Occurrence generation, pending view, skip, schedule-cancel | Done |
| Auto-materialize due occurrences into expense transactions | Done |
| Promo pricing + email reminders (Resend/SMTP) | Done |
| GitHub Actions cron (`subscription-reminders.yml`) | Done |
| `SubscriptionsView` + `SubscriptionRegisterModal` UI | Done |
| Calendar pending subscription indicators | Done |
| Shared ledger support for subscriptions | Done — scoped via group member `owner_id`s |

## 6. Current App Views
| View | Description |
|------|-------------|
| **Calendar** | Monthly calendar with daily income/expense totals and pending subscription markers |
| **List** | Sortable, filterable transaction list |
| **Dashboard** | Net worth, monthly cash flow, account balances, exchange-rate totals |
| **Subscriptions** | Recurring bills and installment management |

Navigation: sidebar (desktop) + bottom tab bar (mobile). Header filters: **Shared | Personal** + ALL / CAD / KRW.

## 7. Remaining Work (Priority Order)

### P0 — Couple core — Done
1. Partner invitation flow — Done
2. Shared / Personal header toggle — Done
3. Shared data access (group-scoped queries) — Done

### P1 — Analytics (Phase 4)
4. **Recharts integration** — Done (Dashboard pie + trend bar; stocks deferred)
5. **Category breakdown UI** — Done
6. **yfinance stock prices** — Deferred to a separate Stocks tab / PR

### P2 — AI input (Phase 3)
7. **PDF statement parsing** — Groq + pdfplumber endpoint
8. **Receipt OCR** — Gemini 1.5 Flash batch upload (multi-image → JSON array)
9. **CSV bulk upload** — web UI + backend import

### P3 — Polish
10. **PWA icons** — add `frontend/public/icons/icon-192x192.png` and `icon-512x512.png`
11. **Email settings UI** — expose reminder preferences (backend email infra exists)
12. **Deploy pipeline** — Vercel (frontend) + Heroku (backend) production config
13. **Leave shared group / unlink partners** — not in P0

## 8. Suggested Next Task
Add a **Stocks** tab (yfinance + net worth) as its own PR, or start **P2** AI/CSV input.
