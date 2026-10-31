# Language and layout rules

The KO/EN toggle changes the language of the text. Nothing else. The same tabs, cards, buttons and features appear in every language, and the layout looks the same in each of them.

These rules exist so that adding a language, or changing a label, cannot break a screen. `npm run check:i18n` enforces the parts that can be checked by a script. The rest is checked by looking at the screen.

## 1. What is shown never depends on the language

- Do not branch rendering on the UI language. No `locale === "ko"` to show or hide a tab, card, button or section.
- Which ledgers, countries and features a user sees comes from their data and settings, never from the language they are viewing the app in.
- Switching language must not write anything that changes what is shown. The KO/EN toggle calls `PUT /api/settings/active-locale`, which only changes the active language. The list of chosen languages is changed only in onboarding and in Settings.
- Formatting that follows the language (dates, number separators) is fine, as long as it does not change which content appears.

## 2. All text lives in the message files

- Every user-facing string goes in both `frontend/messages/ko.json` and `frontend/messages/en.json` and is read with `useTranslations()`. This includes `aria-label`, `title`, placeholders, and error and hint messages.
- Both files have the same keys and the same `{placeholders}` for each key.
- Do not build a sentence by joining pieces. Use one message with placeholders, so each language can order the words.
- Use ICU plurals for counts: `{count, plural, one {# item} other {# items}}`.
- Category and sub-category names are data. Show them through `translateCategory()` and `translateSubCategory()`.

## 3. Keep labels short

Labels on tabs, toggles, segmented controls and buttons have a length budget. Count characters in English, which is usually the longer language.

| Where | English budget |
| --- | --- |
| Tab, toggle and segmented control labels | 12 characters |
| Buttons | 14 characters |
| Select options and sort choices | 18 characters |
| Card and section titles | 28 characters |
| Hints and helper text | May wrap, never truncate |

When a label is over budget, shorten the word instead of making the control wider:

| Instead of | Use |
| --- | --- |
| Highest valuation | Top value |
| Highest yield | Top yield |
| Valuation | Value |
| Add holding | Add stock |
| Back to dashboard | Back |

Keep the Korean and English labels of one control similar in length, so the control keeps the same width in both languages.

## 4. Build layouts that survive longer text

- A row of controls is a flex container with `flex-wrap`. Each group inside it is one unit (`shrink-0`) that moves to the next line as a whole, never splits in the middle.
- Labels on buttons, tabs and segmented controls use `whitespace-nowrap`. A label must never break onto two lines.
- Long dynamic text (account names, merchants, user notes) uses `min-w-0` with `truncate`. Long fixed text is shortened in the message file, not truncated.
- No fixed widths or heights on elements that contain text. Use padding, `min-w-*` and `gap`.
- Numbers and amounts use `tabular-nums` and `whitespace-nowrap`.
- Do not rely on a language being shorter than another. Design for the longest.

## 5. Check before you open a pull request

1. Run `cd frontend && npm run check:i18n`.
2. Open every screen you changed in Korean and in English.
3. Look at a phone width (375 px) and a desktop width (1280 px).
4. For anything that shows labels in a row (tabs, toolbars, headers), confirm the same items appear in both languages and nothing wraps inside a control.

## 6. Adding a language

1. Add the locale to `frontend/i18n/locales.ts` and create `frontend/messages/<code>.json` from `en.json`.
2. Extend `scripts/check-i18n.mjs` so the new file is compared with `en.json`.
3. Walk through the screens in section 5 with the new language. If a control breaks, shorten the label for that language (section 3) instead of changing the layout.

## About `check:i18n`

- It fails when `ko.json` and `en.json` differ in keys or placeholders.
- It fails when a file gains hardcoded Korean text or rendering that branches on the language. Existing cases are counted per file in `frontend/scripts/i18n-baseline.json` and may only go down.
- When you remove hardcoded text, run `npm run check:i18n -- --update` to lower the baseline. Never raise it to make a new string pass; move the text into the message files instead.
