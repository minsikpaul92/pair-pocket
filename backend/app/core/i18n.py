"""Server-side text (emails) from the language packs in app/locales.

Packs merge like the web UI: ko (the source), then en (the fallback), then the
requested locale, and empty strings count as untranslated. Messages use
`str.format` placeholders (`{name}`). See docs/I18N.md.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from app.core.locales import BASE_LOCALE, FALLBACK_LOCALE, SUPPORTED_LOCALE_CODES

PACKS_DIR = Path(__file__).resolve().parents[1] / "locales"


def flatten(data: dict, prefix: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in data.items():
        if isinstance(value, dict):
            out.update(flatten(value, f"{prefix}{key}."))
        else:
            out[f"{prefix}{key}"] = str(value)
    return out


@lru_cache
def load_pack(code: str) -> dict[str, str]:
    """Flat keys of one pack, or {} when the locale has no pack yet."""
    path = PACKS_DIR / f"{code}.json"
    if not path.exists():
        return {}
    return flatten(json.loads(path.read_text(encoding="utf-8")))


def resolve_locale(value: str | None, default: str = BASE_LOCALE) -> str:
    return value if value in SUPPORTED_LOCALE_CODES else default


def message_chain(locale: str) -> list[str]:
    """Packs merged for a locale, least specific first."""
    if locale == BASE_LOCALE:
        return [BASE_LOCALE]
    return list(dict.fromkeys([BASE_LOCALE, FALLBACK_LOCALE, locale]))


@lru_cache
def messages(locale: str) -> dict[str, str]:
    merged: dict[str, str] = {}
    for code in message_chain(locale):
        merged.update({key: text for key, text in load_pack(code).items() if text})
    return merged


def translate(locale: str | None, key: str, **params: object) -> str:
    """Text for `key` in `locale`; unknown locales use the base pack."""
    return messages(resolve_locale(locale))[key].format(**params)
