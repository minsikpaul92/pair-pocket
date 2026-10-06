# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commits, pull requests and comments

- Never mention Claude, Claude Code, or AI authorship anywhere in commits, pull requests, or comments. This includes `Co-Authored-By` trailers, session links, and "Generated with" footers.
- Write every pull request title and description, and every GitHub comment or review reply, in English.
- Do not use em dashes in documents, pull requests, or comments.

## Branches

- `main` is the live service and deploys automatically. Never commit or push to `main` directly.
- Branch from `develop` and open pull requests into `develop`. Only release pull requests from `develop` (and `hotfix/*` branches) merge into `main`. See `docs/BRANCHING.md`.

## Korean and English parity

- Korean is the source of truth. Every user-visible feature must behave identically in ko and en; only the language changes.
- Never hardcode Korean (or English) text in components. Add the string to both `frontend/messages/ko.json` and `frontend/messages/en.json` with the same key and the same `{placeholders}`.
- Run `npm run check:i18n` in `frontend` before pushing. It fails on key or placeholder mismatches and on new hardcoded Hangul. When you remove hardcoded strings, run `node scripts/check-i18n.mjs --update-baseline` so the debt only goes down.
- Backend `detail` messages are Korean and are not shown to users as-is: `translateError` in `frontend/lib/errors.ts` only translates codes from `messages/*.json` `errors.*` and otherwise shows the generic fallback. Do not rely on a backend message reaching the user.
