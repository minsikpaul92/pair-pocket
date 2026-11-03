# Test accounts

Built-in test accounts for a test deployment: Tester 1 to 4 (1 and 2 Korean, 3 and 4 English; 1+2 and 3+4 are couples). They need no Google sign-in.

## Turning it on

Set `TEST_LOGIN_PASSWORD` (a long random value) on the API. It only takes effect when `MONGODB_DB_NAME` ends in `_staging`, `_test` or `_dev` (`backend/app/services/staging_login.py`). Production uses `pairpocket`, so a stray `TEST_LOGIN_PASSWORD` there does nothing and every endpoint answers 404. Keep it unset in production anyway.

## Using it

Open `/test` (redirects to `/en/auth/test`). The page is not linked anywhere and is kept out of search results, but the address is not a secret: the password and the database name check are the real gate.

1. Pick an account card, enter the password, press sign in. The password is remembered in that browser.
2. A new account starts set up: linked with its partner, with default accounts, onboarding done.
3. **Reset** offers four choices: all accounts as linked couples with default accounts; linked couples with demo data; all accounts empty (the next sign-in starts at onboarding); only the selected account as a new user.

## Demo data

The demo reset gives both couples the same month, so the test server and a local run start from the same state (for example before recording screens). Tester 1 and 2 get Korean names, Tester 3 and 4 English ones. The data lives in `backend/app/services/staging_demo.py`:

- Accounts: a Chequing, Visa and Savings account for each tester (TD for Tester 1 and 3, RBC for Tester 2 and 4), a Tangerine joint chequing account for the couple, and a Wealthsimple TFSA (CAD) and Kiwoom (KRW) brokerage for Tester 1 and 3 with three well-known stocks each. Everything else is in CAD.
- This month: salaries and a side income, both partners funding the joint account, a savings transfer, and everyday spending across categories in both ledgers, spread over the days of the month that have passed (early in the month they share the days up to today; nothing is dated later).
- Fixed bills: shared rent, a phone plan and Netflix. Bills due by today are recorded; the rest show as upcoming.
- A $100 "Dinner with friends" paid from Tester 1 and 3's Visa, not yet settled, for trying settlement.

Stock prices are looked up online when the stocks screen opens, like for any user.

Wrong passwords wait one second before answering.
