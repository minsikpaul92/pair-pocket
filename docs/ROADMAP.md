# PairPocket roadmap

Planned work, ordered by priority. Unchecked items are not completed or guaranteed by the current release. The overview of the product is in the [README](../README.md).

The first phase addresses review findings and reported reliability problems before expanding analysis features.

## Phase 1: Privacy, data integrity, and reliability

- [x] **Protect linked transactions.** Transaction relationships are server-managed. Updates and deletes verify ownership, ledger access, and the reciprocal relationship, with regression coverage preventing one user from mutating another user's unrelated transactions.
- [x] **Keep personal history out of shared suggestions.** Merchant and institution lookups follow the selected ledger scope, so shared autocomplete does not include a partner's personal history.
- [x] **Preserve historical partnership boundaries.** Shared transactions, accounts, subscriptions, occurrences, and holdings carry the stable group ID that created them. Unlinking archives that group, and a new partnership cannot read its records. Legacy active-pair records were migrated with a verified dry run and pre-change JSON backup; ambiguous records fail closed.
- [x] **Make partnership changes atomic.** Invitation acceptance and unlinking use conditional updates inside MongoDB transactions. Concurrent or repeated acceptance cannot leave only one partner linked, and the partnership group lifecycle is recorded explicitly.
- [x] **Make account and card defaults reliable.** Replace the current mix of account flags, unused settings fields, and browser-only stock defaults with one server-backed source of truth. Add a Settings section for personal/shared and currency-specific default spending accounts, income accounts, payment cards, subscription payment methods, and brokerage accounts. Show default badges and quick actions on dashboard account cards, and expose independent applicable choices in account editing instead of one context-dependent checkbox. Make switching atomic, validate account type/currency/group access, define fallback behavior when a default is deleted or deactivated, remove stock `localStorage` defaults, and migrate existing flags without changing account balances or history. Ensure transaction, subscription, transfer, and stock forms all resolve defaults through the same rules and retain actionable errors when no valid account exists.
- [x] **Make paired shared-funding writes atomic.** Personal ↔ shared transfers work in both directions and can be entered from either ledger; the server creates, updates, and deletes the other side with it. Paired creates, edits, deletes, and converting an ordinary entry into a transfer run in one MongoDB transaction, with regression coverage showing a failed twin write or conversion rolls back the whole pair.
- [x] **Validate settlements consistently.** Settlements must match the expense's currency and ledger. The expense is locked inside the transaction so concurrent settlements cannot exceed it, and expenses with settlements cannot drop below the settled total, change ledger, currency, or direction, or be deleted.
- [x] **Keep sessions signed in reliably.** Investigate token expiry, browser storage, and authentication error handling; the current access token lifetime is seven days. Implement renewable sessions with rotating, revocable refresh credentials and protected cookie handling suitable for the deployed frontend/API domains. Retry authentication once after refresh, keep network failures separate from expired sessions, and preserve drafts if sign-in is required.
- [ ] **Preserve input and explain failures.** Close or clear a form only after confirmed save success. Retain drafts after failed saves, prevent duplicate submissions, and show actionable English/Korean messages for missing fields, invalid account/currency combinations, expired sessions, and server failures. Isolate any persisted drafts by user and clear sensitive drafts on logout. Distinguish failed loading from an empty ledger and provide retry controls.
- [ ] **Add core regression coverage.** Cover authorization, partnership changes, settlements, paired transfers, balances, session renewal, and failed-save recovery. Run relevant backend tests and frontend type/build checks in CI before merging behavioral changes.

## Phase 2: Import workflows and a consistent experience

- [ ] **Process multiple receipt images.** Support selecting multiple files, show progress and a separate review result for each receipt, and allow users to group images belonging to the same receipt. Preserve successful results when another receipt fails. Save reviewed receipts individually or as a batch, track saved/failed states, and retry only failed entries without duplicates.
- [ ] **Import monthly card-statement PDFs with duplicate review.** Extract and normalize statement rows, then compare them with existing transactions using the account, currency, amount, transaction/posting dates, and normalized merchant. Label rows as new, likely duplicate, or requiring review. Do not silently discard legitimate repeated purchases. Use import identifiers to make retries safe and let users confirm which new rows to save.
- [x] **Unify Korean and English layouts.** *(Shipped with the layout rules in [`i18n-and-layout.md`](./i18n-and-layout.md).)* Use the Korean layout as the structural baseline for both languages and countries. Separate language preference from country, currency, and account settings; move language switching into Settings. Keep controls, navigation, and feature availability consistent while allowing translated text to wrap naturally. Check both languages at mobile and desktop widths.
- [x] **Add release notes to Settings.** *(Shipped as the What's New list next to Alerts, with a red dot on the bell for new entries.)* Maintain versioned English/Korean entries with a date and sections for additions, improvements, and fixes. Display the current version and release history in Settings. Update these entries as part of each release; planned work must not appear as shipped.
- [ ] **Explain the app before sign-in.** Add a public introduction page covering who the app is for, personal versus shared ledgers, supported currencies, subscriptions, stocks, receipt imports, privacy, Gemini key requirements, and the steps to get started. Use examples and screenshots with a clear Google sign-in action. Keep this introduction separate from the existing post-login account setup and describe only available features as available.

## Phase 3: Spending detail and budgets

- [ ] **Add weekly spending analysis.** *(Started in `feat/expense-ratio` ([#52](https://github.com/minsikpaul92/pair-pocket/pull/52)): the expense mix has a Sunday–Saturday week view with previous/next navigation across month boundaries; weekly trend and previous-week comparison remain.)* Provide weekly totals, a weekly trend, and previous-week comparisons in the dashboard. Define one week-boundary and user-timezone policy, label partial weeks, and handle weeks crossing month/year boundaries consistently. Reuse existing settlement and transfer rules so weekly and monthly totals reconcile.
- [ ] **Browse item-level subcategories.** Introduce a clear hierarchy of category, subcategory, and item group; keep merchant as a separate dimension. Preserve raw receipt descriptions and add normalized item names, quantities, units, and group IDs. Let Gemini suggest reusable groups and let users correct assignments. Support filtering and totals at all three levels without double-counting receipt items and their parent transaction; account for taxes, tips, and discounts explicitly.
- [ ] **Recognize custom categories in Gemini imports.** Include the user's current allowed categories, subcategories, descriptions, and relevant corrections in each classification request. Validate returned category IDs on the server and flag uncertain assignments for review. Offer explicit reclassification of historical items. Adding a category updates the supplied context; it does not automatically train Gemini.
- [ ] **Set monthly budgets and explain spending.** Support personal/shared budgets with a defined currency, a monthly total, and category allocations. Calculate actual spending, remaining budget, pacing, and projected month-end spending in application code. Explain overspending and practical savings opportunities with Gemini using those verified totals. Separate recurring commitments and transfers appropriately, and make exchange-rate assumptions visible for combined-currency views.

## Phase 4: Evidence-based comparisons and shopping advice

- [ ] **Compare with relevant households and personal goals.** Collect optional region, age band, occupation, gender, and household size, with clear consent for AI use and controls to edit/delete the profile. Start with the user's budget, spending history, income, assets, and savings goals. Add external peer comparisons only when credible statistics support them; show the source, year, geography, household definition, and limitations. Broaden the comparison group or state that data is unavailable when an exact group such as “Toronto students in their mid-30s” is unsupported. Averages are context, not a verdict on an individual household.
- [ ] **Compare shopping unit prices.** Start with the user's own receipts. Normalize price per kilogram, liter, or item and compare equivalent products, accounting for package size, product cut/type, discounts, and purchase date. Show the receipts supporting each suggestion. Add external store prices only through an available, permitted, sufficiently current data source; Gemini must not invent current Metro/Costco prices or claim that a past price is available today.

## Delivery and acceptance

All phases are feasible as application work. External demographic benchmarks and current store-price recommendations depend on suitable data sources; Gemini alone cannot supply verified averages or live prices.

For each completed item:

1. Define the expected behavior and data/API changes before implementation.
2. Include migration and recovery steps when stored data changes.
3. Validate the affected paths, including personal/shared boundaries and English/Korean behavior where relevant.
4. Update release notes and check off the roadmap item only after its acceptance checks pass and it ships.

## Branch and pull request plan

Use `main` as the release branch and short-lived `docs/`, `fix/`, and `feat/` branches for focused changes. The branch names below are proposed work units, not claims that implementation already exists.

| Order | Branch | Status | Scope |
| --- | --- | --- | --- |
| 0 | `docs/roadmap` | Complete ([#48](https://github.com/minsikpaul92/pair-pocket/pull/48)) | Live URL and this English implementation roadmap |
| 1 | `fix/ledger-access` | Complete ([#49](https://github.com/minsikpaul92/pair-pocket/pull/49)) | Linked-entry authorization and private lookup isolation |
| 2 | `fix/partnership-scope` | Complete ([#50](https://github.com/minsikpaul92/pair-pocket/pull/50)) | Historical group scoping, migration, and atomic invitation lifecycle |
| 3 | `feat/expense-ratio` | Complete ([#52](https://github.com/minsikpaul92/pair-pocket/pull/52)) | Weekly (Sun–Sat) expense mix, transfer exclusion, hideable categories |
| 4 | `fix/account-defaults` | Complete ([#51](https://github.com/minsikpaul92/pair-pocket/pull/51)) | Server-backed account/card defaults and Settings management |
| 5 | `fix/ledger-integrity` | Complete ([#53](https://github.com/minsikpaul92/pair-pocket/pull/53)) | Atomic paired writes, settlement validation, and shared↔personal transfers entered from either side |
| 6 | `fix/session-persistence` | Complete ([#55](https://github.com/minsikpaul92/pair-pocket/pull/55)) | Session diagnosis, renewal, and expiry recovery |
| 7 | `fix/save-recovery` | Planned | Draft preservation, readable errors, and safe retries |
| 8 | `feat/receipt-batches` | Planned | Multiple-receipt review and partial-failure recovery |
| 9 | `feat/statement-import` | Planned | PDF transaction import and duplicate review |
| 10 | `feat/unified-layout` | Complete ([#68](https://github.com/minsikpaul92/pair-pocket/pull/68)) | Shared layout and Settings-only language preference |
| 11 | `feat/release-notes` | Complete ([#69](https://github.com/minsikpaul92/pair-pocket/pull/69)) | Versioned release history in Settings |
| 12 | `feat/public-introduction` | Planned | Product explanation before sign-in |
| 13 | `feat/weekly-spending` | In progress (weekly expense mix shipped in [#52](https://github.com/minsikpaul92/pair-pocket/pull/52); trend and comparison remain) | Weekly dashboard analysis |
| 14 | `feat/item-classification` | Planned | Item groups and custom-category AI context |
| 15 | `feat/monthly-budgets` | In progress (monthly total shipped in [#64](https://github.com/minsikpaul92/pair-pocket/pull/64); category allocations and grounded AI explanations remain) | Budgets, pacing, and grounded AI explanations |
| 16 | `feat/peer-comparisons` | Planned | Optional profile and sourced benchmarks |
| 17 | `feat/unit-price-insights` | Planned | Receipt-based unit prices and shopping advice |

Start each independent change from the latest `main`. Merge prerequisite data/model changes before starting dependent work, or explicitly use a dependent PR while its prerequisite is under review. Avoid putting the whole roadmap into one branch. Each PR should explain the problem, resulting behavior, verification, and any migration requirements. Push the branch to `origin`, open a PR into `main`, and merge after review and required checks. Enable appropriate branch protection in GitHub if it is not already configured.
