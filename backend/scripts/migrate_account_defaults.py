"""Copy legacy is_default_* flags into default slots, then optionally clean up."""

import argparse
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient

from app.config import get_settings
from app.services.account_defaults_migration import apply, cleanup_legacy, plan


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate account default flags into account_defaults slots."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--apply",
        action="store_true",
        help="Write the planned slots (accounts are not modified). Omit for a dry run.",
    )
    mode.add_argument(
        "--cleanup-legacy",
        action="store_true",
        help="After the slot release is verified: back up and unset legacy fields.",
    )
    parser.add_argument("--backup-dir", default="migration-backups")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    settings = get_settings()
    client = AsyncIOMotorClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    try:
        if args.cleanup_legacy:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            backup_path = Path(args.backup_dir) / f"account-defaults-{stamp}.json"
            counts = await cleanup_legacy(db, backup_path)
            print(f"Backup written to: {backup_path.resolve()}")
            print(f"Unset legacy fields: {counts}")
            return

        result = await plan(db)
        for section, rows in result["report"].items():
            print(f"{section}: {len(rows)}")
            for row in rows:
                print(f"  {json.dumps(row, ensure_ascii=False)}")
        if not args.apply:
            print("Dry run only. Review the report and rerun with --apply.")
            return
        written = await apply(db, result)
        print(f"Slots written: {written}")
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
