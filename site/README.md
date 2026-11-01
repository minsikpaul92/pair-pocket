# Pair Pocket landing site

A static, standalone page for Pair Pocket, published with GitHub Pages. It does not share code with the app. Plain HTML, CSS and a small script; one Node script renders each language into `site/dist`.

## Edit

| What | Where |
| --- | --- |
| Words (every language) | `i18n/<code>.json` |
| Layout | `src/index.template.html`, `src/styles.css`, `src/main.js` |
| Links (GitHub, LinkedIn, portfolio, app, coffee, site URL) | `config/links.json` |
| App recordings | `media/` (see `media/RECORDING.md`) |
| Social images | `og/og-<code>.png` (1200x630) |

Keep wording consistent with the app's `frontend/messages/ko.json` and `en.json`. Do not use em dashes.

### Portfolio link

`config/links.json` has `"portfolio": ""`. While it is empty the footer shows "Portfolio (coming soon)" with no link. Put the full `https://` URL there and rebuild.

### Add a language

1. Copy `i18n/en.json` to `i18n/<code>.json` and translate every value.
2. Add an entry to `i18n/locales.json` (`code`, `label`, `short`, `path`, `ogLocale`, `appPath`).
3. Add `og/og-<code>.png`.

The language switcher, `hreflang` tags, sitemap and the automatic choice by the visitor's system language pick it up. `node scripts/check.mjs` fails when a pack is missing a key.

## Build and preview

```bash
node site/scripts/check.mjs
node site/scripts/build.mjs
cd site/dist && python3 -m http.server 4173
```

`build.mjs --strict` (used in CI) fails on leftover `REPLACE_ME` values. It only warns about recording placeholders.

## Deploy

`.github/workflows/pages.yml` builds and publishes `site/dist` when `site/**` changes on `main`. One-time setup: repository Settings, Pages, Source: GitHub Actions. All internal URLs are relative, so the same build works at `/pair-pocket/` and at a custom domain; for a custom domain change `siteUrl` in `config/links.json` and add a `CNAME` file to `src/`.
