"""Atomic partnership lifecycle; ledger records never move between groups."""

import secrets
from datetime import datetime

from bson import ObjectId
from fastapi import HTTPException
from pymongo.errors import ConfigurationError, OperationFailure


async def _transaction(db, callback):
    try:
        async with await db.client.start_session() as session:
            return await session.with_transaction(callback)
    except ConfigurationError as exc:
        raise HTTPException(
            503, "Partnership changes require MongoDB transaction support."
        ) from exc
    except OperationFailure as exc:
        if exc.code == 20:
            raise HTTPException(
                503, "Partnership changes require MongoDB transaction support."
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
            raise HTTPException(404, "Invitation not found or expired.")
        if invite["invitee_email"].lower() != user.email.lower():
            raise HTTPException(403, "Sign in with the invited email address.")
        if invite["inviter_id"] == user.id:
            raise HTTPException(400, "You cannot accept your own invitation.")
        inviter = await db.users.find_one(
            {"_id": ObjectId(invite["inviter_id"])}, session=session
        )
        if not inviter:
            raise HTTPException(404, "Inviter not found.")

        group_id = secrets.token_urlsafe(16)
        members = [invite["inviter_id"], user.id]
        for member in members:
            claimed = await db.users.update_one(
                {"_id": ObjectId(member), "shared_group_id": None},
                {"$set": {"shared_group_id": group_id}},
                session=session,
            )
            if claimed.matched_count != 1:
                raise HTTPException(
                    409, "One of these users is already linked. Refresh and try again."
                )

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
            raise HTTPException(409, "Invitation has already been handled.")
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
        raise HTTPException(400, "No active partnership.")

    async def archive(session):
        member = await db.users.find_one(
            {"_id": ObjectId(user.id), "shared_group_id": group_id},
            session=session,
        )
        if not member:
            raise HTTPException(409, "Partnership changed. Refresh and try again.")
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
