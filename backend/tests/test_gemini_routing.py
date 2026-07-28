"""Unit tests for Gemini quota-aware routing helpers."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from app.services.ai import (
    FALLBACK_MODELS,
    PRIMARY_MODEL,
    build_model_chain,
    compute_resume_at,
    iter_batches,
)


def test_iter_batches_default_size_three():
    items = list(range(7))
    batches = list(iter_batches(items))
    assert batches == [[0, 1, 2], [3, 4, 5], [6]]


def test_build_model_chain_skips_primary_while_cooled_down():
    resume = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    chain, skip = build_model_chain(
        {"cooldown_model": PRIMARY_MODEL, "resume_at": resume}
    )
    assert chain == list(FALLBACK_MODELS)
    assert skip is not None
    assert skip["skipped_model"] == PRIMARY_MODEL


def test_build_model_chain_uses_primary_after_resume():
    resume = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    chain, skip = build_model_chain(
        {"cooldown_model": PRIMARY_MODEL, "resume_at": resume}
    )
    assert chain[0] == PRIMARY_MODEL
    assert skip is None


def test_compute_resume_at_honors_retry_after_seconds():
    resp = MagicMock()
    resp.headers = {"retry-after": "90"}
    before = datetime.now(timezone.utc)
    resume = compute_resume_at(resp, "anything")
    assert before + timedelta(seconds=89) <= resume <= before + timedelta(seconds=91)


def test_compute_resume_at_daily_quota_uses_pacific_midnight():
    resp = MagicMock()
    resp.headers = {}
    resume = compute_resume_at(
        resp,
        "You exceeded your current quota / generate_requests_per_model_per_day",
    )
    # Should be in the future (next PT midnight).
    assert resume > datetime.now(timezone.utc)
