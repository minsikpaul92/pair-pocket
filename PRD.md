# Product Requirements Document (PRD) : PairPocket

> **Last updated:** 2026-07-30 — Contextual AI scan (per-tab + / camera), remove Smart Import AI scanner, List add entry, stocks CAD/USD display, dashboard currency toggle cleanup.

## 1. Project Overview
* **Project Name:** PairPocket
* **Description:** A custom AI-powered dual-currency (KRW/CAD) expense tracker built for an immigrant couple in Canada to manage shared and personal finances seamlessly.
* **Target Users:** Paul and Lucy (A couple needing real-time shared asset management).
* **Design System:** Apple HIG (Refer to `design.md` for details). Maintain an intuitive and minimal UI.

## 2. Tech Stack
* **Frontend:** Next.js (App Router), React, Tailwind CSS, Lucide React (Icons), next-intl (i18n), @ducanh2912/next-pwa
* **Backend:** FastAPI (Python), Motor (async MongoDB)
* **Database:** MongoDB (Atlas)
* **AI & Data Analysis:**
  * Gemini API: Custom user API Key (stored in `user_settings`), utilizing `gemini-3.5-flash` or `gemini-3.1-flash-lite`
  * Text & PDF Analysis: pdfplumber + Gemini API
  * Image OCR (Receipts): Gemini API
  * Stock Data: Yahoo Finance API (httpx, 2-hour cache in MongoDB)
* **Infrastructure:** Vercel (Frontend), Heroku (Backend), PWA (Progressive Web App), GitHub Actions (subscription reminder cron)

## 3. Core Features (MVP)

### A. Account & Ledger Management
* **Google OAuth Login:** Simple sign-up and login via Google accounts.
* **Invitation System:** Email invitation to link two users into a single Shared Group.
* **Dual Ledger System:**
  * `Shared Ledger`: Read/Write access for both users, real-time synchronization.
  * `Personal Ledger`: Read/Write access only for the individual owner, completely hidden from the partner.
* **Multi-Currency Support:** All transactions must be categorized and stored as either `KRW` or `CAD`. Stock transactions additionally support `USD`.

### B. Input Methods
* **App UI:** Intuitive manual input form featuring auto-completion for recently used merchants and frequent categories.
* **AI Auto-Input (PDF/Photo):**
  * Extract date, amount, currency, and merchant automatically from credit card statement PDFs or receipt images.
* **PC Bulk Upload:** Support CSV file uploads via the web interface for fast, bulk data entry.

### C. Advanced Dashboard & Analytics
* **Total Net Worth:** Track the combined total assets (Cash + Stocks). Stock valuations are included and synced in real time.
* **Dynamic Filtering:**
  * By Currency: CAD Only, KRW Only, Total (Applying exchange rates).
  * By Ownership: Shared Only, Personal Only, Shared + Personal.
* **Stock Account Status Section:** A dedicated section on the Dashboard shows per-account and total investment balances (cash + stock valuation).
* **Charts:** Monthly expense ratio (Pie Chart) and Quarterly/Bi-annual/Annual trends (Bar/Line Chart).

### D. Stock Portfolio Management
* **Stock Tab:** Dedicated tab listing all brokerage accounts with holdings and real-time performance.
* **Brokerage Account Setup:** Users can add investment accounts (Wealthsimple, Kiwoom, Mirae Asset, etc.) with country (Canada/Korea) differentiation. Default account can be set per country.
* **Real-Time Stock Prices:** Current price and previous close fetched via Yahoo Finance API, cached 2 hours in MongoDB.
* **Holdings Auto-Calculation:** Every buy/sell transaction recalculates total shares, average cost, and current valuation automatically via `sync_holding_from_transactions`.
* **Performance Cards:** Per-account and all-accounts-combined profit/loss summary cards with color-coded yield indicators (red = profit, blue = loss). Clicking a card filters the holdings list below.
* **Ledger Scope Filtering:** Stock tab filters match the global navigation scope (CAD/KRW/ALL).
* **Sell via Owned Holdings Dropdown:** When recording a stock sale (income tab → 주식 판매수익), users select from their currently owned holdings — with auto-populated ticker, account, and currency — plus a guide badge showing owned shares and average cost.

### E. Contextual AI Scan (per-tab entry, not a global dump)
AI photo/file scan must open the **same create flow as that tab’s `+` button**, with a prompt scoped to that domain. Do **not** use a generic Smart Import AI scanner that leaves “where does this parse to?” ambiguous.

| View | `+` opens | Camera / in-modal photo scan opens / fills |
|------|-----------|--------------------------------------------|
| **Dashboard / Calendar / List** | New transaction (`TransactionModal`) | Same modal; **Expense** tab → expense-only parse; **Income** tab → income-only parse. Receipts also fill **sub-category** and line items when present. |
| **List (header)** | Explicit **Add** control (same as FAB `+`) | Same as above |
| **Calendar day click** | New transaction for that date | Same modal; optional photo analyze inside the modal |
| **Subscriptions** | Subscription register modal | Subscription-oriented screenshot parse (same family as onboarding) |
| **Stocks** | Add holding / brokerage flow | Brokerage holdings screenshot parse (same family as onboarding) |
| **Dashboard section `+ 추가`** (cards, stock accounts, bank/assets) | `AccountRegisterModal` for that kind | Account/asset screenshot parse (reuse onboarding assets/brokerage scan) |

* **Floating actions:** Camera sits above `+` where the view already has a view-specific FAB (subscriptions, stocks). On dashboard / calendar / list, FAB `+` and camera both target **transactions**; camera may open the modal with scan, or scan into the open modal.
* **Scan options (when offered):** Take photo, upload photos, upload PDF/file (as applicable to that flow).
* **Gemini parsing:** User-supplied Gemini API key; model fallback chain. Extract fields appropriate to the active flow (transaction vs subscription vs holding vs account). Always confirm in the matching modal before save.
* **Smart Import view:** Keep **CSV import/export** and **OCR/import logs** only. **Remove the AI File Scanner sub-tab** from Smart Import / File Management (context-free parse is out of product scope).

### F. Dynamic Translation & Custom AI Settings
* **User-Provided API Key:** Users can input and save their Gemini API Key in the settings page. It is stored securely in `user_settings`.
* **AI-Driven Localization:** When a user selects a language not pre-loaded (e.g., Chinese, Japanese, Vietnamese, French), the app uses the Gemini API to dynamically translate the core localization packs (based on `ko.json` or `en.json`) and generate/cache them on the fly.

### G. Development & Test Data Reset
* **Data Reset Endpoint:** A dedicated settings option/endpoint to purge test data (transactions, holdings, subscriptions) while preserving user accounts and configuration for quick iterative testing.

## 4. Database Schema Guidelines (MongoDB)
* `users`: User information, OAuth tokens, and associated `shared_group_id`.
* `transactions`: Unified storage for all transaction records.
  * Required fields: `date`, `amount`, `currency` (KRW/CAD/USD), `type` (income/expense), `account_type` (shared/personal), `category`, `merchant`, `owner_id`.
  * Stock-specific fields: `is_stock_trade`, `ticker`, `stock_name`, `shares`, `price_per_share`, `transaction_currency`.
* `accounts`: Financial accounts (checking, savings, credit card, investment, cash) with balances and institution metadata.
* `holdings`: Aggregated stock positions per user, account, and ticker. Fields: `ticker`, `stock_name`, `shares`, `avg_price`, `currency`, `account_id`, `account_type`.
* `stock_prices`: Cached real-time price data per ticker (2-hour TTL). Fields: `ticker`, `price`, `prev_close`, `currency`, `name`, `updated_at`.
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

### Phase 3: AI Integration & Batch Upload — 0% complete
| Item | Status |
|------|--------|
| Groq (Gemma) + pdfplumber integration | Not started |
| Gemini 1.5 Flash OCR | Not started |
| PDF auto-extraction API | Not started |
| Batch receipt image upload (single Gemini batch request) | Not started |
| CSV bulk upload | Not started |

### Phase 4: Dashboard & Stocks — ~95% complete
| Item | Status |
|------|--------|
| Exchange-rate conversion for ALL view (Frankfurter API + cache) | Done |
| Net worth summary widget (account balances) | Done |
| Stats API (`/api/stats/summary` — monthly flow, category breakdown) | Done |
| Recharts Pie / Bar charts on Dashboard | Done — expense mix pie + 3/6/12 month income·expense trend |
| Category breakdown UI | Done — list beside pie from `expense_breakdown_by_category` |
| Stock tab (`StocksView`) with brokerage account selector | Done — PR #9 |
| Real-time stock prices (Yahoo Finance API, 2h MongoDB cache) | Done — PR #9 |
| Holdings auto-sync from buy/sell transactions | Done — PR #9, `sync_holding_from_transactions` |
| Per-account & combined performance cards (profit, yield, color-coded) | Done — PR #9 |
| Dashboard "Stock Account Status" section with valuation | Done — PR #9 |
| Net worth includes stock valuation | Done — PR #9 |
| Ledger-scope filtering for stock tab and transaction modal | Done — PR #9 |
| Owned holdings dropdown for stock sell (income tab) | Done — PR #9 |

## 6. Current App Views
| View | Description |
|------|-------------|
| **Calendar** | Monthly calendar with daily income/expense totals and pending subscription markers; day click → new transaction |
| **List** | Sortable, filterable transaction list; must expose an **Add** control (same create path as FAB `+`) in addition to the floating `+` / camera |
| **Dashboard** | Net worth (cash + stocks), monthly cash flow, account balances, stock account status; section `+` for accounts; FAB for new transactions |
| **Subscriptions** | Recurring bills and installment management; own FAB (`+` / camera → subscription flows) |
| **Stocks** | Brokerage accounts with real-time holdings; own FAB (`+` / camera → holdings); Canada tab supports CAD / USD / native-all display (CAD as `$`, USD as `US$`) |
| **Smart Import** | CSV bulk import/export + import logs only (no standalone AI file scanner) |
| **Settings** | Partner, Gemini key, theme, support, data reset |

Navigation: sidebar (desktop) + bottom tab bar (mobile). Header filters: **Shared | Personal** + ALL / CAD / KRW.

### Product decisions (2026-07-30)
* **Contextual scan only:** Camera/`+` behavior is view-specific (see §3.E). Global AI dump in Smart Import is removed.
* **Dashboard ALL currency UI:** Keep CAD/KRW toggle on **net worth** only; remove the duplicate toggle on the monthly net-flow card (same `display` state).
* **Stocks Canada:** Distinguish CAD `$` vs USD `US$`; allow CAD↔USD rollup toggle and an “all / native” mode so mixed wallets can coexist (mirror Korea KRW/USD pattern).

## 7. Remaining Work (Priority Order)

### P0 — Couple core — Done
1. Partner invitation flow — Done
2. Shared / Personal header toggle — Done
3. Shared data access (group-scoped queries) — Done

### P1 — Analytics (Phase 4)
4. **Recharts integration** — Done (Dashboard pie + trend bar)
5. **Category breakdown UI** — Done
6. **Stock tab + real-time prices** — Done (PR #9)

### P2 — AI input & contextual entry (active)
7. **Remove Smart Import AI File Scanner** — keep CSV + logs only
8. **Contextual transaction scan** — photo analyze inside / into `TransactionModal`; expense vs income scoped; sub-category + line items on receipts
9. **List Add button** — header/primary Add that opens the same new-transaction path as FAB `+`
10. **Dashboard account `+` scan** — reuse onboarding-style screenshot fill on `AccountRegisterModal`
11. **Stocks Canada CAD/USD/`US$` + native-all** — display and rollup parity with Korea tab
12. **Dashboard duplicate currency toggle** — keep net-worth toggle only
13. **CSV bulk upload** — already in Smart Import; keep polishing as needed

### P3 — Polish
14. **PWA icons** — add `frontend/public/icons/icon-192x192.png` and `icon-512x512.png`
15. **Email settings UI** — expose reminder preferences (backend email infra exists)
16. **Deploy pipeline** — Vercel (frontend) + Heroku (backend) production config
17. **Public OAuth open** — after soak test; consent + rate limits (see GitHub #35)
18. **EN i18n gaps** — hard-coded Korean hints in scan/FAB/modals

## 8. Suggested Next Task
Ship the **contextual AI scan + List Add + stocks CAD/USD + dashboard toggle cleanup** package above (P2 items 7–12), then continue soak testing before public OAuth Publish (#35).
