"""Atomic partnership lifecycle; ledger records never move between groups."""

import secrets
from datetime import datetime

from bson import ObjectId
from fastapi import status
from pymongo.errors import ConfigurationError, OperationFailure

from app.core.errors import AppError


async def _transaction(db, callback):
    try:
        async with await db.client.start_session() as session:
            return await session.with_transaction(callback)
    except ConfigurationError as exc:
        # MongoDB without transaction support (not a replica set).
        raise AppError(
            status.HTTP_503_SERVICE_UNAVAILABLE, "serverUnavailable"
        ) from exc
    except OperationFailure as exc:
        if exc.code == 20:
            raise AppError(
                status.HTTP_503_SERVICE_UNAVAILABLE, "serverUnavailable"
            ) from exc
        raise


async def accept_partner_invitation(db, user, token: str) -> tuple[str, dict]:
    async def accept(session):
        now = datetime.utcnow()
        invite = await db.invitations.find_one(
            {"token": token, "status": "pending", "expires_at": {"$gt": now}},
            session=session,
        )
        if not invite:
            raise AppError(404, "invitationNotFound")
        if invite["invitee_email"].lower() != user.email.lower():
            raise AppError(403, "invitationEmailMismatch")
        if invite["inviter_id"] == user.id:
            raise AppError(400, "cannotAcceptOwnInvitation")
        inviter = await db.users.find_one(
            {"_id": ObjectId(invite["inviter_id"])}, session=session
        )
        if not inviter:
            raise AppError(404, "inviterNotFound")

        group_id = secrets.token_urlsafe(16)
        members = [invite["inviter_id"], user.id]
        for member in members:
            claimed = await db.users.update_one(
                {"_id": ObjectId(member), "shared_group_id": None},
                {"$set": {"shared_group_id": group_id}},
                session=session,
            )
            if claimed.matched_count != 1:
                raise AppError(409, "partnerLinkConflict")

        await db.shared_groups.insert_one(
            {
                "_id": group_id,
                "members": members,
                "status": "active",
                "created_at": now,
                "shared_ledger_start_date": invite.get("shared_ledger_start_date"),
            },
            session=session,
        )
        start = invite.get("shared_ledger_start_date")
        for member in members:
            await db.user_settings.update_one(
                {"owner_id": member},
                {
                    "$set": {"shared_ledger_start_date": start},
                    "$setOnInsert": {
                        "merchants": [],
                        "institutions": [],
                        "custom_categories": {"expense": {}, "income": {}},
                        "category_colors": {},
                        "onboarding_personal_completed": False,
                        "onboarding_personal_step": 0,
                    },
                },
                upsert=True,
                session=session,
            )
        claimed = await db.invitations.update_one(
            {"_id": invite["_id"], "status": "pending"},
            {
                "$set": {
                    "status": "accepted",
                    "accepted_at": now,
                    "accepted_by": user.id,
                    "shared_group_id": group_id,
                }
            },
            session=session,
        )
        if claimed.matched_count != 1:
            raise AppError(409, "invitationAlreadyHandled")
        await db.invitations.update_many(
            {
                "status": "pending",
                "$or": [
                    {"inviter_id": {"$in": members}},
                    {
                        "invitee_email": {
                            "$in": [user.email.lower(), inviter["email"].lower()]
                        }
                    },
                ],
            },
            {"$set": {"status": "revoked"}},
            session=session,
        )
        return group_id, inviter

    return await _transaction(db, accept)


async def archive_partnership(db, user) -> None:
    group_id = user.shared_group_id
    if not group_id:
        raise AppError(400, "noActivePartnership")

    async def archive(session):
        member = await db.users.find_one(
            {"_id": ObjectId(user.id), "shared_group_id": group_id},
            session=session,
        )
        if not member:
            raise AppError(409, "partnershipChanged")
        members = await db.users.find(
            {"shared_group_id": group_id}, session=session
        ).to_list(length=10)
        await db.shared_groups.update_one(
            {"_id": group_id},
            {
                "$set": {"status": "archived", "archived_at": datetime.utcnow()},
                "$setOnInsert": {"members": [str(m["_id"]) for m in members]},
            },
            upsert=True,
            session=session,
        )
        await db.users.update_many(
            {"shared_group_id": group_id},
            {"$set": {"shared_group_id": None}},
            session=session,
        )

    await _transaction(db, archive)
