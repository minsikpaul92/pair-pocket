from bson import ObjectId
from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.category_preset import (
    is_card_repayment,
    is_transfer_expense,
    requires_institution,
    requires_settlement_link,
)
from app.models.ledger import (
    TRANSFER_SUB_ACCOUNT_TRANSFER,
    TRANSFER_SUB_INVESTMENT_FUNDING,
    TransactionKind,
    is_cashflow_transfer_sub,
    is_etransfer_sub,
    is_shared_funding_sub,
    normalize_transfer_category,
    normalize_transfer_sub_category,
)
from app.models.transaction import AccountType, TransactionCreate, TransactionType
from app.models.user import UserOut
from app.routers.settings import _get_or_create, _parse_custom
from app.services.access import resolve_owner_ids
from app.services.category_merge import is_valid_merged_pair
from app.services.settlement import get_remaining_settlement

ACCOUNTS_COL = "accounts"


async def _load_owned_account(
    db: AsyncIOMotorDatabase,
    *,
    account_id: str,
    owner_id: str | None = None,
    owner_ids: list[str] | None = None,
    label: str,
) -> dict:
    if not ObjectId.is_valid(account_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"유효하지 않은 {label} ID입니다.",
        )
    ids = owner_ids if owner_ids is not None else ([owner_id] if owner_id else [])
    if not ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"선택한 {label}을(를) 찾을 수 없습니다.",
        )
    owner_clause: dict = (
        {"owner_id": ids[0]} if len(ids) == 1 else {"owner_id": {"$in": ids}}
    )
    account = await db[ACCOUNTS_COL].find_one(
        {
            "_id": ObjectId(account_id),
            **owner_clause,
            "is_active": True,
        }
    )
    if not account:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"선택한 {label}을(를) 찾을 수 없습니다.",
        )
    return account


def _assert_currency(account: dict, payload: TransactionCreate, label: str) -> None:
    if account.get("currency") != payload.currency.value:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{label} 통화와 거래 통화가 일치하지 않습니다.",
        )


def _assert_account_matches_payload(
    account: dict, payload: TransactionCreate, label: str
) -> None:
    _assert_currency(account, payload, label)
    if account.get("account_type") != payload.account_type.value:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{label}의 공용/개인 구분이 거래와 일치하지 않습니다.",
        )


def _assert_account_type(
    account: dict, expected: AccountType, label: str
) -> None:
    if account.get("account_type") != expected.value:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{label}는 {expected.value} 계좌여야 합니다.",
        )


async def validate_transaction_payload(
    payload: TransactionCreate,
    db: AsyncIOMotorDatabase,
    owner_id: str,
    *,
    owner_ids: list[str] | None = None,
    exclude_settlement_id: str | None = None,
    current_user: UserOut | None = None,
) -> None:
    doc = await _get_or_create(db, owner_id)
    custom = _parse_custom(doc)
    account_owner_ids = owner_ids if owner_ids is not None else [owner_id]

    # Normalize legacy transfer names before validation.
    normalized_category = normalize_transfer_category(payload.category)
    if normalized_category != payload.category:
        payload.category = normalized_category
    normalized_sub = normalize_transfer_sub_category(payload.sub_category)
    if normalized_sub != payload.sub_category:
        payload.sub_category = normalized_sub

    is_transfer = is_transfer_expense(payload.category)
    is_shared_funding = is_transfer and is_shared_funding_sub(payload.sub_category)
    is_etransfer = is_transfer and is_etransfer_sub(payload.sub_category)
    is_cashflow = is_transfer and is_cashflow_transfer_sub(payload.sub_category)

    # Shared-funding income twin is allowed; other transfer cats are expense-only.
    if is_transfer and payload.type != TransactionType.EXPENSE:
        if not (
            is_shared_funding and payload.type == TransactionType.INCOME
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="[자산 이동/카드]는 지출(type=expense)로만 등록할 수 있습니다.",
            )

    if is_shared_funding and payload.type == TransactionType.EXPENSE:
        if payload.account_type != AccountType.PERSONAL:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="공용 계좌 입금은 개인 장부에서만 등록할 수 있습니다.",
            )

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
    elif payload.institution and not payload.is_stock_trade:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="institution 필드는 [투자/저축] 카테고리 혹은 주식 거래에서만 사용할 수 있습니다.",
        )

    if requires_settlement_link(payload.type, payload.category, payload.sub_category):
        if not payload.settles_expense_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="[N빵 정산/환급]은 정산 대상 지출(settles_expense_id) 선택이 필요합니다.",
            )
        remaining = await get_remaining_settlement(
            db,
            owner_id,
            payload.settles_expense_id,
            owner_ids=account_owner_ids,
            exclude_settlement_id=exclude_settlement_id,
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

    if is_etransfer:
        if not payload.account_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="e-Transfer는 출금 계좌가 필요합니다.",
            )
        if payload.counter_account_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="e-Transfer는 입금 계좌를 사용하지 않습니다.",
            )
        from_account = await _load_owned_account(
            db,
            account_id=payload.account_id,
            owner_ids=account_owner_ids,
            label="출금 계좌",
        )
        _assert_account_matches_payload(from_account, payload, "출금 계좌")
        if from_account.get("is_liability"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="e-Transfer의 출금 계좌는 자산 계좌여야 합니다.",
            )
        return

    if is_shared_funding:
        if not payload.account_id or not payload.counter_account_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="공용 계좌 입금은 출금(개인)과 입금(공용) 계좌가 모두 필요합니다.",
            )
        if payload.account_id == payload.counter_account_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="출금 계좌와 입금 계좌는 서로 달라야 합니다.",
            )
        if current_user is None or not current_user.shared_group_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="공용 계좌 입금을 쓰려면 먼저 파트너를 초대해야 합니다.",
            )
        personal_ids = await resolve_owner_ids(
            db, current_user, AccountType.PERSONAL
        )
        shared_ids = await resolve_owner_ids(db, current_user, AccountType.SHARED)
        if not shared_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="공용 계좌 입금을 쓰려면 먼저 파트너를 초대해야 합니다.",
            )

        if payload.type == TransactionType.EXPENSE:
            # Personal expense: account_id=personal, counter=shared
            from_account = await _load_owned_account(
                db,
                account_id=payload.account_id,
                owner_ids=personal_ids,
                label="출금 계좌",
            )
            to_account = await _load_owned_account(
                db,
                account_id=payload.counter_account_id,
                owner_ids=shared_ids,
                label="입금 계좌",
            )
            _assert_account_type(from_account, AccountType.PERSONAL, "출금 계좌")
            _assert_account_type(to_account, AccountType.SHARED, "입금 계좌")
        else:
            # Shared income twin: account_id=shared, counter=personal
            to_account = await _load_owned_account(
                db,
                account_id=payload.account_id,
                owner_ids=shared_ids,
                label="입금 계좌",
            )
            from_account = await _load_owned_account(
                db,
                account_id=payload.counter_account_id,
                owner_ids=personal_ids,
                label="출금 계좌",
            )
            _assert_account_type(to_account, AccountType.SHARED, "입금 계좌")
            _assert_account_type(from_account, AccountType.PERSONAL, "출금 계좌")

        _assert_currency(from_account, payload, "출금 계좌")
        _assert_currency(to_account, payload, "입금 계좌")
        if from_account.get("is_liability") or to_account.get("is_liability"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="공용 계좌 입금은 자산 계좌 간에만 가능합니다.",
            )
        return

    if is_transfer and not is_cashflow:
        if not payload.account_id or not payload.counter_account_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="[자산 이동/카드]는 출금 계좌와 입금 계좌가 모두 필요합니다.",
            )
        if payload.account_id == payload.counter_account_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="출금 계좌와 입금 계좌는 서로 달라야 합니다.",
            )
        if (
            payload.kind != TransactionKind.TRANSFER
            and payload.kind != TransactionKind.NORMAL
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="유효하지 않은 거래 종류(kind)입니다.",
            )

        from_account = await _load_owned_account(
            db,
            account_id=payload.account_id,
            owner_ids=account_owner_ids,
            label="출금 계좌",
        )
        to_account = await _load_owned_account(
            db,
            account_id=payload.counter_account_id,
            owner_ids=account_owner_ids,
            label="입금 계좌",
        )
        _assert_account_matches_payload(from_account, payload, "출금 계좌")
        _assert_account_matches_payload(to_account, payload, "입금 계좌")

        if is_card_repayment(payload.category, payload.sub_category):
            if from_account.get("is_liability"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="카드 대금 상환의 출금 계좌는 자산 계좌여야 합니다.",
                )
            if not to_account.get("is_liability"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="카드 대금 상환의 입금 계좌는 신용카드여야 합니다.",
                )
        elif payload.sub_category == TRANSFER_SUB_ACCOUNT_TRANSFER:
            if from_account.get("is_liability") or to_account.get("is_liability"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="내 계좌 이동은 자산 계좌 간에만 가능합니다.",
                )
        elif payload.sub_category == TRANSFER_SUB_INVESTMENT_FUNDING:
            if from_account.get("is_liability"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="투자 계좌 입금의 출금 계좌는 자산 계좌여야 합니다.",
                )
            if to_account.get("kind") != "investment":
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="투자 계좌 입금의 입금 계좌는 투자 계좌여야 합니다.",
                )
        return

    if payload.counter_account_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="counter_account_id는 [자산 이동/카드]에서만 사용할 수 있습니다.",
        )
    if payload.kind == TransactionKind.TRANSFER:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="kind=transfer는 [자산 이동/카드] 카테고리에서만 사용할 수 있습니다.",
        )

    if payload.account_id:
        account = await _load_owned_account(
            db,
            account_id=payload.account_id,
            owner_ids=account_owner_ids,
            label="계좌",
        )
        _assert_account_matches_payload(account, payload, "계좌")
