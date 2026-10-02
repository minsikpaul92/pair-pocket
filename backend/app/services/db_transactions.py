"""Multi-document MongoDB transactions for writes that must land together."""

from fastapi import HTTPException
from pymongo.errors import ConfigurationError, OperationFailure


async def run_in_transaction(db, callback):
    """Run `callback(session)` in a transaction (retried on transient errors).

    Requires a replica set (MongoDB Atlas). Tests replace this with an
    in-memory version that rolls back on failure.
    """
    try:
        async with await db.client.start_session() as session:
            return await session.with_transaction(callback)
    except ConfigurationError as exc:
        raise HTTPException(
            503, "This change requires MongoDB transaction support."
        ) from exc
    except OperationFailure as exc:
        if exc.code == 20:  # IllegalOperation: standalone server
            raise HTTPException(
                503, "This change requires MongoDB transaction support."
            ) from exc
        raise
