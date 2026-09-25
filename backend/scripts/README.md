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
