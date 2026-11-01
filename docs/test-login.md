# Test accounts

Built-in test accounts for a test deployment: Tester 1 to 4 (1 and 2 Korean, 3 and 4 English; 1+2 and 3+4 are couples). They need no Google sign-in.

## Turning it on

Set `TEST_LOGIN_PASSWORD` (a long random value) on the API. It only takes effect when `MONGODB_DB_NAME` ends in `_staging`, `_test` or `_dev` (`backend/app/services/staging_login.py`). Production uses `pairpocket`, so a stray `TEST_LOGIN_PASSWORD` there does nothing and every endpoint answers 404. Keep it unset in production anyway.

## Using it

Open `/test` (redirects to `/en/auth/test`). The page is not linked anywhere and is kept out of search results, but the address is not a secret: the password and the database name check are the real gate.

1. Pick an account card, enter the password, press sign in. The password is remembered in that browser.
2. A new account starts set up: linked with its partner, with default accounts, onboarding done.
3. **Reset** offers three choices: all accounts as linked couples with default accounts; all accounts empty (the next sign-in starts at onboarding); only the selected account as a new user.

Wrong passwords wait one second before answering.
