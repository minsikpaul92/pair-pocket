"""Multi-document MongoDB transactions for writes that must land together."""

from fastapi import status
from pymongo.errors import ConfigurationError, OperationFailure

from app.core.errors import AppError


async def run_in_transaction(db, callback):
    """Run `callback(session)` in a transaction (retried on transient errors).

    Requires a replica set (MongoDB Atlas). Tests replace this with an
    in-memory version that rolls back on failure.
    """
    try:
        async with await db.client.start_session() as session:
            return await session.with_transaction(callback)
    except ConfigurationError as exc:
        # MongoDB without transaction support (not a replica set).
        raise AppError(
            status.HTTP_503_SERVICE_UNAVAILABLE, "serverUnavailable"
        ) from exc
    except OperationFailure as exc:
        if exc.code == 20:  # IllegalOperation: standalone server
            raise AppError(
                status.HTTP_503_SERVICE_UNAVAILABLE, "serverUnavailable"
            ) from exc
        raise
