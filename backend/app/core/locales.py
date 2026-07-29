"""Supported UI locales for PairPocket.

MVP ships full message packs for `ko` and `en` only. Other locales are Beta:
they appear in the picker and fall back to English copy until packs ship post-publish.
"""

from __future__ import annotations

# Display order for onboarding / Settings language pickers.
LOCALE_OPTIONS: list[dict[str, str | bool]] = [
    {"code": "en", "label": "English", "native": "English", "beta": False},
    {"code": "ko", "label": "한국어", "native": "한국어", "beta": False},
    {"code": "fr", "label": "Français", "native": "Français", "beta": True},
    {
        "code": "zh-Hans",
        "label": "中文 (Mandarin)",
        "native": "普通话",
        "beta": True,
    },
    {
        "code": "zh-Hant",
        "label": "中文 (Cantonese)",
        "native": "粤语",
        "beta": True,
    },
    {"code": "ja", "label": "日本語", "native": "日本語", "beta": True},
    {"code": "es", "label": "Español", "native": "Español", "beta": True},
    {"code": "vi", "label": "Tiếng Việt", "native": "Tiếng Việt", "beta": True},
    {"code": "fil", "label": "Filipino", "native": "Filipino", "beta": True},
    {"code": "pa", "label": "Punjabi", "native": "ਪੰਜਾਬੀ", "beta": True},
]

SUPPORTED_LOCALE_CODES = {str(item["code"]) for item in LOCALE_OPTIONS}
