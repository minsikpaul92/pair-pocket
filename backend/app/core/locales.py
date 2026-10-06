"""Supported UI locales for PairPocket.

The list lives in `locales.json`, a mirror of `frontend/i18n/locales.json`;
`npm run check:i18n` and tests/test_i18n_packs.py keep the two in sync. Beta
locales appear in the pickers and show English until their packs are
translated. See docs/I18N.md.
"""

from __future__ import annotations

import json
from pathlib import Path

# Pack every key is written in first.
BASE_LOCALE = "ko"
# Pack shown for keys a language has not translated yet.
FALLBACK_LOCALE = "en"

# Display order for onboarding / Settings language pickers.
LOCALE_OPTIONS: list[dict[str, str | bool]] = json.loads(
    Path(__file__).with_name("locales.json").read_text(encoding="utf-8")
)

SUPPORTED_LOCALE_CODES = {str(item["code"]) for item in LOCALE_OPTIONS}
