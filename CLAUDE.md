# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commits, pull requests and comments

- Never mention Claude, Claude Code, or AI authorship anywhere in commits, pull requests, or comments. This includes `Co-Authored-By` trailers, session links, and "Generated with" footers.
- Write every pull request title and description, and every GitHub comment or review reply, in English.
- Do not use em dashes in documents, pull requests, or comments.

## Branches

- `main` is the live service and deploys automatically. Never commit or push to `main` directly.
- Branch from `develop` and open pull requests into `develop`. Only release pull requests from `develop` (and `hotfix/*` branches) merge into `main`. See `docs/BRANCHING.md`.

## Language packs

See `docs/I18N.md` for the full workflow.

- Korean is the source of truth. Every user-visible feature must behave identically in every language; only the text changes.
- Never hardcode Korean (or English) text in components. Add the string to both `frontend/messages/ko.json` and `frontend/messages/en.json` with the same key and the same `{placeholders}`.
- Run `npm run check:i18n` in `frontend` before pushing. It fails on key or placeholder mismatches, broken ICU syntax, registry drift and any hardcoded Hangul outside the data modules.
- The API never sends display text. Raise `AppError(status, "camelCaseCode", **params)` (`backend/app/core/errors.py`), never `HTTPException`, and add `errors.server.<code>` to `ko.json` and `en.json`. Email text lives in `backend/app/locales/<code>.json`. `backend/tests/test_i18n_packs.py` enforces both.
