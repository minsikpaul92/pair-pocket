"""Inspect or migrate legacy shared records after reviewing their ownership."""

import argparse
import asyncio
from datetime import datetime, timezone
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient

from app.config import get_settings
from app.services.shared_scope_migration import (
    inspect_legacy_shared_records,
    migrate_legacy_shared_records,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Back up and assign legacy shared records to one verified group."
    )
    parser.add_argument("--group-id", required=True)
    parser.add_argument("--member-id", action="append", required=True)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write a JSON backup and apply the group ID. Omit for a dry run.",
    )
    parser.add_argument("--backup-dir", default="migration-backups")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    settings = get_settings()
    client = AsyncIOMotorClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    try:
        counts = await inspect_legacy_shared_records(db, args.member_id)
        print("Legacy shared records:")
        for collection, count in counts.items():
            print(f"  {collection}: {count}")
        if not args.apply:
            print("Dry run only. Review the members and rerun with --apply.")
            return

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = (
            Path(args.backup_dir) / f"shared-scope-{args.group_id}-{stamp}.json"
        )
        migrated = await migrate_legacy_shared_records(
            db,
            group_id=args.group_id,
            member_ids=args.member_id,
            backup_path=backup_path,
        )
        print(f"Backup written to: {backup_path.resolve()}")
        print("Migrated records:")
        for collection, count in migrated.items():
            print(f"  {collection}: {count}")
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
