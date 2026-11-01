# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commits, pull requests and comments

- Never mention Claude, Claude Code, or AI authorship anywhere in commits, pull requests, or comments. This includes `Co-Authored-By` trailers, session links, and "Generated with" footers.
- Write every pull request title and description, and every GitHub comment or review reply, in English.
- Do not use em dashes in documents, pull requests, or comments.

## Language and layout

The UI language only changes text. Read `docs/i18n-and-layout.md` before touching user-facing text, tabs, toolbars or any screen that shows labels, and follow it.

- Put every user-facing string in both `frontend/messages/ko.json` and `frontend/messages/en.json`. Do not hardcode Korean or English in components.
- What is shown must not depend on the UI language (no tabs, cards or features that appear only in one language).
- Keep tab, toggle and button labels short, and never let a label wrap.
- Run `npm run check:i18n` in `frontend` before opening a pull request, and look at the screens you changed in both languages.

## What's New

What's New is for users, not developers. Add an entry only when a user would notice the change: something they can now do, or a problem they ran into that is now fixed. Leave out anything only developers care about.

Every pull request that changes the frontend or backend gets one of two outcomes, decided in the same pull request:

| Change | What's New |
| --- | --- |
| New feature, or a screen that clearly changed | Add an entry (minor version) |
| Bug fix for something users ran into (for example, a save that failed) | Add an entry (patch version) |
| Typos, spacing, colors, tiny visual tweaks | No entry |
| Refactors, tests, docs, CI, dependency bumps, internal changes | No entry |

When there is no entry, write `What's New: none (<short reason>)` in the pull request description, so a skipped entry is clearly on purpose.

When there is an entry:

- Add it at the top of `WHATS_NEW` in `frontend/lib/whats-new.ts`: a camelCase `id`, a `version` that bumps the previous top entry, and today's `date`.
- Add `whatsNew.items.<id>.title` and `whatsNew.items.<id>.description` to both `frontend/messages/ko.json` and `frontend/messages/en.json`.
- Write for the user: one or two plain sentences about what they can now do or what got better. Describe only what this pull request ships, not planned work, and use no developer terms. No em dashes.
- The red dot on the bell comes from the top entry's `id`, so a new entry alerts everyone once. Do not reuse an existing `id`.
- Run `npm run check:i18n`. It fails when an entry has no title or description in either message file. Then write the entry (`id` and version) in the pull request description as `What's New: <id> <version>`.
