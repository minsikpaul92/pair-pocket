# Data migration scripts

## Shared-ledger group scope

Shared records created before `shared_group_id` was stored on each record are hidden by default. This prevents records from an unknown former partnership from appearing in a new partnership.

Before deploying the group-scoping release, inspect each active pair separately from the `backend` directory:

```bash
python -m scripts.migrate_shared_group_scope \
  --group-id CURRENT_GROUP_ID \
  --member-id FIRST_USER_OBJECT_ID \
  --member-id SECOND_USER_OBJECT_ID
```

The command is a dry run unless `--apply` is provided. Confirm the group and both users in the database, take a database-level backup, then apply:

```bash
python -m scripts.migrate_shared_group_scope \
  --group-id CURRENT_GROUP_ID \
  --member-id FIRST_USER_OBJECT_ID \
  --member-id SECOND_USER_OBJECT_ID \
  --backup-dir migration-backups \
  --apply
```

The apply command verifies that both users currently belong to the supplied group, writes a BSON-aware JSON backup, and tags only unscoped shared records owned by those users. Records already assigned to another group are left unchanged. Keep the generated backup secure because it contains financial data; the backup directory is excluded from Git.

Do not migrate records when the historical partnership is uncertain. They remain inaccessible until an operator assigns them after review.

## Account default slots

Default accounts moved from per-account `is_default_*` flags to the `account_defaults` collection (one document per ledger scope, currency tab, and role). Migration happens in two steps so that both the old and new releases keep working.

**1. Copy flags into slots (non-destructive).** Run a dry run from the `backend` directory, review the report, and then apply. Apply it right before or right after deploying the slot release; accounts are not modified, so the previous release is unaffected.

```bash
python -m scripts.migrate_account_defaults
python -m scripts.migrate_account_defaults --apply
```

The report lists how ambiguous data was resolved:

- `duplicates`: several accounts were flagged for one slot. The most recently updated account wins.
- `dropped_ineligible`: the flag was on an account that cannot hold that role (for example, a credit card flagged as the income account).
- `replaced_inactive`: only inactive accounts were flagged. The most recently used eligible active account takes the slot.
- `emptied_inactive`: same as above, but no eligible account exists, so the slot stays empty. The next account the user creates claims it.
- `kept_existing`: the slot already exists (a user changed it after deploy, or an earlier run). It is never overwritten, so rerunning `--apply` after deploy is safe.

**2. Remove legacy fields (after the release is verified).** This writes a BSON-aware JSON backup of the old flags and the unused `user_settings.default_expense_account_id` / `default_income_account_id`, then unsets them:

```bash
python -m scripts.migrate_account_defaults --cleanup-legacy --backup-dir migration-backups
```

The API keeps returning the deprecated `is_default_*` fields (derived from slots) and accepts them on writes, so clients built before this release keep working.
