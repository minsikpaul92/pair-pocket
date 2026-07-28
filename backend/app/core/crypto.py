"""Symmetric encryption helpers for secrets stored in MongoDB."""

from __future__ import annotations

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

logger = logging.getLogger(__name__)

# Prefix so we can detect ciphertext vs legacy plaintext.
_PREFIX = "enc:v1:"


def _fernet() -> Fernet:
    """Build a Fernet instance from SETTINGS_ENCRYPTION_KEY or SECRET_KEY."""
    settings = get_settings()
    raw = (settings.settings_encryption_key or settings.secret_key or "").strip()
    if not raw:
        raise RuntimeError(
            "SETTINGS_ENCRYPTION_KEY or SECRET_KEY is required to encrypt secrets."
        )

    # Accept a ready-made Fernet key (url-safe base64 of 32 bytes).
    try:
        return Fernet(raw.encode("utf-8"))
    except (ValueError, TypeError):
        # Derive a stable 32-byte Fernet key from an arbitrary passphrase.
        derived = base64.urlsafe_b64encode(
            hashlib.sha256(raw.encode("utf-8")).digest()
        )
        return Fernet(derived)


def is_encrypted(value: str | None) -> bool:
    return bool(value) and value.startswith(_PREFIX)


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a short secret for at-rest storage."""
    token = _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")
    return f"{_PREFIX}{token}"


def decrypt_secret(value: str) -> str:
    """
    Decrypt a stored secret.

    Legacy plaintext values (no prefix) are returned as-is for lazy migration.
    """
    if not value:
        return value
    if not is_encrypted(value):
        return value

    token = value[len(_PREFIX) :]
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        logger.error("Failed to decrypt stored secret (wrong encryption key?)")
        raise ValueError("Stored secret could not be decrypted.") from exc
