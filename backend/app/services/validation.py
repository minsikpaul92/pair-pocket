from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.category_preset import requires_institution, requires_settlement_link
from app.models.transaction import TransactionCreate
from app.routers.settings import _get_or_create, _parse_custom
from app.services.category_merge import is_valid_merged_pair
from app.services.settlement import get_remaining_settlement


async def validate_transaction_payload(
    payload: TransactionCreate,
    db: AsyncIOMotorDatabase,
    owner_id: str,
) -> None:
    doc = await _get_or_create(db, owner_id)
    custom = _parse_custom(doc)

    if not is_valid_merged_pair(
        custom, payload.type, payload.category, payload.sub_category
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Invalid category/sub_category pair: "
                f"'{payload.category}' / '{payload.sub_category}' "
                f"for type '{payload.type.value}'."
            ),
        )

    if requires_institution(payload.category):
        if not payload.institution:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="[투자/저축] 카테고리는 금융기관(institution) 입력이 필요합니다.",
            )
    elif payload.institution:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="institution 필드는 [투자/저축] 카테고리에서만 사용할 수 있습니다.",
        )

    if requires_settlement_link(payload.type, payload.category, payload.sub_category):
        if not payload.settles_expense_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="[N빵 정산/환급]은 정산 대상 지출(settles_expense_id) 선택이 필요합니다.",
            )
        remaining = await get_remaining_settlement(
            db, owner_id, payload.settles_expense_id
        )
        if remaining is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="정산 대상 지출을 찾을 수 없습니다.",
            )
        if payload.amount > remaining + 0.001:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"정산 금액이 남은 지출({remaining:.2f})을 초과합니다.",
            )
    elif payload.settles_expense_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="settles_expense_id는 [N빵 정산/환급] 수입에서만 사용할 수 있습니다.",
        )
