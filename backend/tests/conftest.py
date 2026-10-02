"""Pytest configuration for PairPocket backend unit tests."""

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import pytest

from app.services import db_transactions


async def _rollback_transaction(db, callback):
    """In-memory stand-in for a MongoDB transaction (mongomock has none).

    Snapshots every collection and restores it if the callback raises, so
    tests can prove that linked writes land together or not at all.
    """
    names = await db.list_collection_names()
    snapshot = {name: await db[name].find({}).to_list(length=None) for name in names}
    try:
        return await callback(None)
    except BaseException:
        for name in set(names) | set(await db.list_collection_names()):
            await db[name].delete_many({})
            if snapshot.get(name):
                await db[name].insert_many(snapshot[name])
        raise


@pytest.fixture(autouse=True)
def rollback_transactions(monkeypatch):
    monkeypatch.setattr(db_transactions, "run_in_transaction", _rollback_transaction)
