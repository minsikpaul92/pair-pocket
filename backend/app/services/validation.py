from bson import ObjectId
from fastapi import status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.errors import AppError
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
    normalize_transfer_category,
    normalize_transfer_sub_category,
    paired_transfer_ledgers,
)
from app.models.transaction import AccountType, TransactionCreate, TransactionType
from app.models.user import UserOut
from app.routers.settings import _get_or_create, _parse_custom
from app.services.access import resolve_owner_ids
from app.services.category_merge import is_valid_merged_pair
from app.services.settlement import check_settlement

ACCOUNTS_COL = "accounts"
_INVALID = status.HTTP_422_UNPROCESSABLE_ENTITY


async def _load_owned_account(
    db: AsyncIOMotorDatabase,
    *,
    account_id: str,
    owner_id: str | None = None,
    owner_ids: list[str] | None = None,
    field: str,
    shared_group_id: str | None = None,
) -> dict:
    """`field` names the account in errors (an `errors.fields.*` key)."""
    if not ObjectId.is_valid(account_id):
        raise AppError(_INVALID, "invalidAccountId", field=field)
    ids = owner_ids if owner_ids is not None else ([owner_id] if owner_id else [])
    if not ids:
        raise AppError(_INVALID, "selectedAccountNotFound", field=field)
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
        raise AppError(_INVALID, "selectedAccountNotFound", field=field)
    if account.get("account_type") == AccountType.SHARED and (
        not shared_group_id or account.get("shared_group_id") != shared_group_id
    ):
        raise AppError(_INVALID, "accountNotInSharedLedger", field=field)
    return account


def _assert_currency(account: dict, payload: TransactionCreate, field: str) -> None:
    if account.get("currency") != payload.currency.value:
        raise AppError(_INVALID, "accountCurrencyMismatch", field=field)


def _assert_account_matches_payload(
    account: dict, payload: TransactionCreate, field: str
) -> None:
    _assert_currency(account, payload, field)
    if account.get("account_type") != payload.account_type.value:
        raise AppError(_INVALID, "accountLedgerMismatch", field=field)


def _assert_account_type(account: dict, expected: AccountType, field: str) -> None:
    if account.get("account_type") != expected.value:
        raise AppError(
            _INVALID, "accountWrongLedger", field=field, ledger=expected.value
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
    pair = paired_transfer_ledgers(payload.sub_category) if is_transfer else None
    is_etransfer = is_transfer and is_etransfer_sub(payload.sub_category)
    is_cashflow = is_transfer and is_cashflow_transfer_sub(payload.sub_category)

    # Personal↔shared transfers may be entered from the receiving side as
    # income; every other transfer is expense-only.
    if is_transfer and payload.type != TransactionType.EXPENSE and not pair:
        raise AppError(_INVALID, "transferExpenseOnly")
    if pair:
        outflow, inflow = pair
        entry = (payload.account_type.value, payload.type.value)
        if entry not in {
            (outflow, TransactionType.EXPENSE.value),
            (inflow, TransactionType.INCOME.value),
        }:
            raise AppError(_INVALID, "pairedTransferDirection")

    if not is_valid_merged_pair(
        custom, payload.type, payload.category, payload.sub_category
    ):
        raise AppError(_INVALID, "invalidCategoryPair")

    if requires_institution(payload.category):
        if not payload.institution:
            raise AppError(_INVALID, "institutionRequired")
    elif payload.institution and not payload.is_stock_trade:
        raise AppError(_INVALID, "institutionNotAllowed")

    if requires_settlement_link(payload.type, payload.category, payload.sub_category):
        if not payload.settles_expense_id:
            raise AppError(_INVALID, "settlementExpenseRequired")
        await check_settlement(
            db,
            expense_id=payload.settles_expense_id,
            amount=payload.amount,
            currency=payload.currency.value,
            owner_ids=account_owner_ids,
            account_type=payload.account_type,
            shared_group_id=current_user.shared_group_id if current_user else None,
            exclude_settlement_id=exclude_settlement_id,
        )
    elif payload.settles_expense_id:
        raise AppError(_INVALID, "settlementLinkNotAllowed")

    if is_etransfer:
        if not payload.account_id:
            raise AppError(_INVALID, "etransferAccountRequired")
        if payload.counter_account_id:
            raise AppError(_INVALID, "etransferNoCounterAccount")
        from_account = await _load_owned_account(
            db,
            account_id=payload.account_id,
            owner_ids=account_owner_ids,
            shared_group_id=current_user.shared_group_id if current_user else None,
            field="fromAccount",
        )
        _assert_account_matches_payload(from_account, payload, "fromAccount")
        if from_account.get("is_liability"):
            raise AppError(_INVALID, "etransferFromAssetOnly")
        return

    if pair:
        if not payload.account_id or not payload.counter_account_id:
            raise AppError(_INVALID, "pairedTransferAccountsRequired")
        if payload.account_id == payload.counter_account_id:
            raise AppError(_INVALID, "accountsMustDiffer")
        if current_user is None or not current_user.shared_group_id:
            raise AppError(status.HTTP_400_BAD_REQUEST, "partnerRequired")
        shared_ids = await resolve_owner_ids(db, current_user, AccountType.SHARED)
        if not shared_ids:
            raise AppError(status.HTTP_400_BAD_REQUEST, "partnerRequired")
        # Only the current user's own personal accounts; never a partner's.
        ledger_owners = {
            AccountType.PERSONAL.value: [current_user.id],
            AccountType.SHARED.value: shared_ids,
        }
        entry_ledger = payload.account_type.value
        other_ledger = (
            AccountType.SHARED.value
            if entry_ledger == AccountType.PERSONAL.value
            else AccountType.PERSONAL.value
        )
        # account_id is in the entry's ledger, counter_account_id in the other.
        entry_account = await _load_owned_account(
            db,
            account_id=payload.account_id,
            owner_ids=ledger_owners[entry_ledger],
            shared_group_id=current_user.shared_group_id,
            field="account",
        )
        other_account = await _load_owned_account(
            db,
            account_id=payload.counter_account_id,
            owner_ids=ledger_owners[other_ledger],
            shared_group_id=current_user.shared_group_id,
            field="counterAccount",
        )
        _assert_account_type(entry_account, AccountType(entry_ledger), "account")
        _assert_account_type(
            other_account, AccountType(other_ledger), "counterAccount"
        )
        _assert_currency(entry_account, payload, "account")
        _assert_currency(other_account, payload, "counterAccount")
        if entry_account.get("is_liability") or other_account.get("is_liability"):
            raise AppError(_INVALID, "pairedTransferAssetOnly")
        return

    if is_transfer and not is_cashflow:
        if not payload.account_id or not payload.counter_account_id:
            raise AppError(_INVALID, "transferAccountsRequired")
        if payload.account_id == payload.counter_account_id:
            raise AppError(_INVALID, "accountsMustDiffer")
        if (
            payload.kind != TransactionKind.TRANSFER
            and payload.kind != TransactionKind.NORMAL
        ):
            raise AppError(_INVALID, "invalidTransactionKind")

        from_account = await _load_owned_account(
            db,
            account_id=payload.account_id,
            owner_ids=account_owner_ids,
            shared_group_id=current_user.shared_group_id if current_user else None,
            field="fromAccount",
        )
        to_account = await _load_owned_account(
            db,
            account_id=payload.counter_account_id,
            owner_ids=account_owner_ids,
            shared_group_id=current_user.shared_group_id if current_user else None,
            field="toAccount",
        )
        _assert_account_matches_payload(from_account, payload, "fromAccount")
        _assert_account_matches_payload(to_account, payload, "toAccount")

        if is_card_repayment(payload.category, payload.sub_category):
            if from_account.get("is_liability"):
                raise AppError(_INVALID, "cardRepaymentFromAssetOnly")
            if not to_account.get("is_liability"):
                raise AppError(_INVALID, "cardRepaymentToCardOnly")
        elif payload.sub_category == TRANSFER_SUB_ACCOUNT_TRANSFER:
            if from_account.get("is_liability") or to_account.get("is_liability"):
                raise AppError(_INVALID, "accountTransferAssetOnly")
        elif payload.sub_category == TRANSFER_SUB_INVESTMENT_FUNDING:
            if from_account.get("is_liability"):
                raise AppError(_INVALID, "investmentFundingFromAssetOnly")
            if to_account.get("kind") != "investment":
                raise AppError(_INVALID, "investmentFundingToInvestmentOnly")
        return

    if payload.counter_account_id:
        raise AppError(_INVALID, "counterAccountNotAllowed")
    if payload.kind == TransactionKind.TRANSFER:
        raise AppError(_INVALID, "transferKindNotAllowed")

    if payload.account_id:
        account = await _load_owned_account(
            db,
            account_id=payload.account_id,
            owner_ids=account_owner_ids,
            shared_group_id=current_user.shared_group_id if current_user else None,
            field="account",
        )
        _assert_account_matches_payload(account, payload, "account")
