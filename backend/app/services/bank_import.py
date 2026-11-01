"""Bank statement import: parse a headerless CSV and match it to what is already entered.

Bank CSVs have no header: ``date, description, debit, credit, balance``. Debit is
money leaving a deposit account (or a charge on a card); credit is money coming
in (or a card payment/refund).
"""

import csv
import io
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta

DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y")
# Same amount on a nearby day counts as "possibly the same entry".
NEAR_DAYS = 3
AMOUNT_EPSILON = 0.005

HINT_NORMAL = "normal"
HINT_CARD_REPAYMENT = "card_repayment"
HINT_ACCOUNT_TRANSFER = "account_transfer"
HINT_E_TRANSFER = "e_transfer"

STATUS_NEW = "new"
STATUS_DUPLICATE = "duplicate"
STATUS_REVIEW = "review"

_TFR_RE = re.compile(r"\bTFR-(TO|FR)\s+(\d+)\b", re.IGNORECASE)
_NOISE_RE = re.compile(r"[^a-z0-9]+")


@dataclass
class BankRow:
    index: int
    date: date
    description: str
    amount: float
    direction: str  # "out" | "in"
    balance: float | None


def _parse_date(value: str) -> date | None:
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _parse_amount(value: str) -> float | None:
    cleaned = value.strip().replace(",", "").replace("$", "")
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_bank_csv(text: str) -> list[BankRow]:
    """Parse a bank CSV. Rows that do not look like a transaction are skipped."""
    rows: list[BankRow] = []
    for raw in csv.reader(io.StringIO(text.lstrip("﻿"))):
        if len(raw) < 4:
            continue
        parsed_date = _parse_date(raw[0])
        if parsed_date is None:
            continue  # blank line or a header row
        debit = _parse_amount(raw[2])
        credit = _parse_amount(raw[3])
        if debit and credit:
            continue  # ambiguous row: both columns filled
        amount = debit or credit
        if not amount:
            continue
        balance = _parse_amount(raw[4]) if len(raw) > 4 else None
        rows.append(
            BankRow(
                index=len(rows),
                date=parsed_date,
                description=raw[1].strip(),
                amount=round(abs(amount), 2),
                direction="out" if debit else "in",
                balance=balance,
            )
        )
    return rows


def classify_hint(row: BankRow, *, is_card: bool) -> str:
    """What kind of movement this looks like, from the description alone."""
    desc = row.description.upper()
    if is_card:
        if row.direction == "in" and desc.startswith("PAYMENT"):
            return HINT_CARD_REPAYMENT
        return HINT_NORMAL
    if row.direction == "out" and "TFR-TO C/C" in desc:
        return HINT_CARD_REPAYMENT
    if _TFR_RE.search(desc):
        return HINT_ACCOUNT_TRANSFER
    if "E-TRANSFER" in desc or "E-TFR" in desc:
        return HINT_E_TRANSFER
    return HINT_NORMAL


def transfer_counterpart(row: BankRow) -> str | None:
    """The other account number in a ``TFR-TO/FR <number>`` description."""
    found = _TFR_RE.search(row.description)
    return found.group(2) if found else None


def _tokens(text: str) -> set[str]:
    return {t for t in _NOISE_RE.split(text.lower()) if len(t) >= 3}


def _same_merchant(description: str, merchant: str) -> bool:
    return bool(_tokens(description) & _tokens(merchant))


def _doc_date(doc: dict) -> date:
    value = doc["date"]
    return value.date() if isinstance(value, datetime) else value


def match_existing(
    rows: list[BankRow], existing: list[dict], *, is_card: bool
) -> list[dict]:
    """Compare statement rows with already-entered transactions.

    Each existing transaction is claimed by at most one row, so two identical
    purchases on one day need two entries to both count as already entered.
    Returns one result per row: ``status`` plus the matched transaction id.
    """
    claimed: set[str] = set()
    results: list[dict] = [
        {"status": STATUS_NEW, "match_id": None, "reason": None} for _ in rows
    ]

    def candidates(row: BankRow, window: int):
        wanted = "expense" if row.direction == "out" else "income"
        for doc in existing:
            doc_id = str(doc["_id"])
            if doc_id in claimed:
                continue
            if abs(float(doc.get("amount", 0)) - row.amount) > AMOUNT_EPSILON:
                continue
            is_transfer = doc.get("kind") == "transfer"
            if doc.get("type") != wanted and not is_transfer:
                continue
            if abs((_doc_date(doc) - row.date).days) > window:
                continue
            yield doc

    hints = [classify_hint(r, is_card=is_card) for r in rows]

    # Pass 1: same day and same merchant (or a transfer-like row) is a duplicate.
    for i, row in enumerate(rows):
        for doc in candidates(row, 0):
            transfer_like = hints[i] in (HINT_CARD_REPAYMENT, HINT_ACCOUNT_TRANSFER)
            if transfer_like or _same_merchant(row.description, doc.get("merchant", "")):
                claimed.add(str(doc["_id"]))
                results[i] = {
                    "status": STATUS_DUPLICATE,
                    "match_id": str(doc["_id"]),
                    "reason": "same day, amount and merchant",
                }
                break

    # Pass 2: same amount close in time but not clearly the same is left to the user.
    for i, row in enumerate(rows):
        if results[i]["status"] != STATUS_NEW:
            continue
        for doc in candidates(row, NEAR_DAYS):
            claimed.add(str(doc["_id"]))
            results[i] = {
                "status": STATUS_REVIEW,
                "match_id": str(doc["_id"]),
                "reason": "same amount within a few days",
            }
            break

    return results


def window_for(rows: list[BankRow]) -> tuple[date, date] | None:
    """Date range to load existing transactions for, padded for near matches."""
    if not rows:
        return None
    pad = timedelta(days=NEAR_DAYS)
    return min(r.date for r in rows) - pad, max(r.date for r in rows) + pad
