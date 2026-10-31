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

