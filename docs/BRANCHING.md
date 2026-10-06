# Branches and releases

`main` is the live service (www.pairpocket.me). Vercel deploys the frontend and Heroku deploys the API from `main` automatically, so anything merged into `main` reaches users within minutes. All work therefore goes through `develop` first.

```
feat/*, fix/*, docs/*  ──PR──▶  develop  ──release PR──▶  main
                                   ▲                         │
                                   └──── merge back ◀── hotfix/*
```

## Branches

| Branch | Purpose | Deploys to |
| --- | --- | --- |
| `main` | Production. Only release and hotfix PRs merge here. | Vercel production, Heroku production |
| `develop` | Integration. Everything that will ship next lives here first. | Staging (see below) |
| `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>` | One focused change. Branch from `develop`, PR into `develop`. | Vercel preview per branch |
| `hotfix/<topic>` | Urgent production fix. Branch from `main`, PR into `main`, then merge `main` back into `develop`. | Production after merge |

## Everyday flow

```bash
git switch develop
git pull
git switch -c feat/my-change
# work, commit
git push -u origin feat/my-change
```

Open the pull request with **base: `develop`**. CI must pass (frontend lint, i18n check, build; backend tests). Merge with a merge commit or squash, then delete the branch.

## Releasing `develop` to `main`

1. Check `develop` on staging: sign in, add and edit a transaction, open each tab in Korean and English, and run any migration dry runs the release needs.
2. Open a pull request from `develop` into `main` titled `Release YYYY-MM-DD`. List the merged PRs and any migration or environment change.
3. Merge with a **merge commit** (not squash), so `develop` and `main` keep the same history and the next release diff stays small.
4. Watch the Vercel and Heroku deploys, then spot-check production.

If production breaks after a release, revert the release merge commit on `main` with a PR (`git revert -m 1 <merge sha>`), then fix forward on `develop`.

## Hotfixes

```bash
git switch main && git pull
git switch -c hotfix/short-name
# fix, commit, push, PR into main
# after it merges:
git switch develop && git pull
git merge origin/main
git push
```

## GitHub settings (one-time, repository owner)

Settings → Branches → Add branch ruleset (or classic protection rule):

- **`main`**: require a pull request before merging, require status checks `Frontend lint & build`, `Backend unit tests` and `Release source`, block force pushes and deletion.
- **`develop`**: require a pull request, require `Frontend lint & build` and `Backend unit tests`, block force pushes and deletion.
- Settings → General → Default branch: switch to `develop` so new pull requests target it by default. Production deploys keep following `main`.

The `Release source` check (`.github/workflows/branch-policy.yml`) fails any pull request into `main` that does not come from `develop` or a `hotfix/*` branch.

## Staging for `develop`

Staging uses separate infrastructure so testing never touches production data.

| Piece | Setup |
| --- | --- |
| Database | A separate database such as `pairpocket_staging` (same Atlas cluster is fine, or a free M0 cluster). Never point staging at the production database. |
| API | A second Heroku app (for example `pairpocket-api-staging`) connected to this repository with automatic deploys from `develop`. Config vars: `MONGODB_URI`, `MONGODB_DB_NAME=pairpocket_staging`, a new `SECRET_KEY` and `SETTINGS_ENCRYPTION_KEY`, `FRONTEND_URL` and `CORS_ORIGINS` set to the staging frontend URL, `OAUTH_REDIRECT_URI=https://<staging-api>/api/auth/callback`, and `TEST_LOGIN_PASSWORD` (see below). Leave `CRON_SECRET` unset so reminder emails are not sent from staging. |
| Frontend | Vercel already builds every branch as a preview. In the Vercel project, add a domain such as `dev.pairpocket.me` assigned to the `develop` branch, and set `NEXT_PUBLIC_API_BASE_URL` for **Preview** (scoped to branch `develop`) to the staging API URL. |
| Google sign-in | Add the staging redirect URI to the OAuth client (Google Cloud Console → Credentials), or create a separate OAuth client for staging. |

### Test accounts on staging

Staging has four built-in test accounts so testers do not need Google accounts: Tester 1 and Tester 2 (Korean) and Tester 3 and Tester 4 (English), enough for two couples.

- Turn them on with the `TEST_LOGIN_PASSWORD` config var on the staging API. The sign-in page then shows a "Test sign-in" box: pick an account, enter that password.
- The API only honors it when `MONGODB_DB_NAME` ends in `_staging`, `_test` or `_dev`, so the production app (database `pairpocket`) ignores the variable even if it is set by mistake. Use a long random password anyway: the staging URL is public.
- Each account starts like a brand-new user in its language (onboarding included). Test emails go to `tester<N>@example.com`, which never receives mail; invite a tester by that address and use the invite link the app shows when the email cannot be sent.
- "Reset all test accounts" (same password) deletes the four users and everything they own: ledger data, settings, sessions, invitations and their shared groups. A real user linked with a tester is unlinked and keeps their own data.
- Locally, set `MONGODB_DB_NAME=pairpocket_dev` and `TEST_LOGIN_PASSWORD` in `backend/.env` to get the same box.

## Commit and PR conventions

See `CLAUDE.md`: English titles and descriptions, no em dashes, no AI authorship trailers. Keep each PR to one topic and describe the problem, the change, how it was verified, and any migration.
