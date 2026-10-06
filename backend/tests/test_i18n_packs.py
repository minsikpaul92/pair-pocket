"""Language packs the backend depends on (see docs/I18N.md).

- backend/app/core/locales.json mirrors frontend/i18n/locales.json.
- Email packs in backend/app/locales mirror the Korean pack.
- Every error code the API sends has text in the web UI packs, with the
  placeholders the API fills in, and no route sends display text instead.
"""

import ast
import json
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import i18n
from app.core.errors import AppError, app_error_handler
from app.core.locales import (
    BASE_LOCALE,
    FALLBACK_LOCALE,
    LOCALE_OPTIONS,
    SUPPORTED_LOCALE_CODES,
)
from app.models.transaction import AccountType

BACKEND = Path(__file__).resolve().parents[1]
APP = BACKEND / "app"
FRONTEND = BACKEND.parent / "frontend"
PLACEHOLDER = re.compile(r"\{\s*(\w+)")
# Helper arguments that carry an error code, e.g. assert_can_access_doc's.
CODE_ARGS = ("not_found_code",)


def _placeholders(text: str) -> set[str]:
    return set(PLACEHOLDER.findall(text))


def _ui_errors(locale: str) -> dict:
    pack = json.loads((FRONTEND / "messages" / f"{locale}.json").read_text("utf-8"))
    return pack["errors"]


def _const(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _call_name(node: ast.Call) -> str | None:
    func = node.func
    return getattr(func, "id", None) or getattr(func, "attr", None)


def _app_trees():
    for path in sorted(APP.rglob("*.py")):
        yield path, ast.parse(path.read_text("utf-8"), filename=str(path))


def _error_usage() -> tuple[dict[str, list[set[str]]], set[str]]:
    """Codes the API can send (with the params of each use) and `field` values."""
    codes: dict[str, list[set[str]]] = {}
    fields: set[str] = set()

    def use(code: str | None, params: set[str]) -> None:
        if code:
            codes.setdefault(code, []).append(params)

    for _, tree in _app_trees():
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                name = _call_name(node)
                kwargs = {kw.arg for kw in node.keywords if kw.arg} - {"headers"}
                if name == "AppError" and len(node.args) > 1:
                    use(_const(node.args[1]), kwargs)
                elif name == "error_body" and node.args:
                    use(_const(node.args[0]), set())
                for kw in node.keywords:
                    if kw.arg in CODE_ARGS:
                        use(_const(kw.value), set())
                    if kw.arg == "field" and _const(kw.value):
                        fields.add(_const(kw.value))
            elif isinstance(node, ast.Dict):
                # Stream events: {"event": "error", "code": ..., "params": {...}}
                entries = {_const(k): v for k, v in zip(node.keys, node.values)}
                params = entries.get("params")
                names = (
                    {_const(k) for k in params.keys}
                    if isinstance(params, ast.Dict)
                    else set()
                )
                use(_const(entries.get("code")), names)
            elif isinstance(node, ast.arguments):
                # Defaults such as `not_found_code: str = "notFound"`.
                for arg, default in zip(node.kwonlyargs, node.kw_defaults):
                    if arg.arg in CODE_ARGS:
                        use(_const(default), set())
    return codes, fields


def test_locale_registry_mirrors_frontend():
    frontend = json.loads((FRONTEND / "i18n" / "locales.json").read_text("utf-8"))
    expected = [
        {key: item[key] for key in ("code", "label", "native", "beta")}
        for item in frontend["locales"]
    ]
    assert LOCALE_OPTIONS == expected
    assert frontend["baseLocale"] == BASE_LOCALE
    assert frontend["fallbackLocale"] == FALLBACK_LOCALE


def test_email_packs_mirror_the_base_pack():
    base = i18n.load_pack(BASE_LOCALE)
    assert base and all(base.values()), "ko.json is the source: no empty values"
    fallback = i18n.load_pack(FALLBACK_LOCALE)
    assert set(fallback) == set(base) and all(fallback.values()), "en.json is incomplete"

    for path in sorted(i18n.PACKS_DIR.glob("*.json")):
        code = path.stem
        assert code in SUPPORTED_LOCALE_CODES, f"{path.name} is not a registered locale"
        pack = i18n.load_pack(code)
        assert not set(pack) - set(base), f"{path.name} has keys missing from ko.json"
        for key, text in pack.items():
            if text:
                assert _placeholders(text) == _placeholders(base[key]), f"{code}: {key}"


def test_email_text_falls_back_to_english_then_korean():
    ko = i18n.translate("ko", "email.test.subject")
    en = i18n.translate("en", "email.test.subject")
    assert ko != en
    # A beta locale without a pack reads English; an unknown one reads Korean.
    assert i18n.translate("fr", "email.test.subject") == en
    assert i18n.translate("xx", "email.test.subject") == ko
    assert i18n.translate(None, "email.test.subject") == ko
    assert "Alex" in i18n.translate("en", "email.invite.subject", inviter="Alex")


def test_app_error_response_carries_code_and_params():
    app = FastAPI()
    app.add_exception_handler(AppError, app_error_handler)

    @app.get("/boom")
    async def boom():
        raise AppError(422, "selectedAccountNotFound", field="fromAccount")

    res = TestClient(app).get("/boom")
    assert res.status_code == 422
    assert res.json() == {
        "detail": "selectedAccountNotFound",
        "code": "selectedAccountNotFound",
        "params": {"field": "fromAccount"},
    }


def test_routes_raise_codes_not_text():
    offenders = [
        f"{path.relative_to(BACKEND)}:{node.lineno}"
        for path, tree in _app_trees()
        if path != APP / "core" / "errors.py"
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and _call_name(node) == "HTTPException"
    ]
    assert not offenders, f"Raise AppError with a code instead: {offenders}"


@pytest.mark.parametrize("locale", [BASE_LOCALE, FALLBACK_LOCALE])
def test_api_error_codes_have_ui_text(locale):
    errors = _ui_errors(locale)
    codes, fields = _error_usage()
    assert len(codes) > 50, "the error code scan found too few codes"

    missing = sorted(set(codes) - set(errors["server"]))
    assert not missing, f"add errors.server.<code> to messages/{locale}.json: {missing}"
    unused = sorted(set(errors["server"]) - set(codes))
    assert not unused, f"messages/{locale}.json has unused errors.server keys: {unused}"

    for code, uses in codes.items():
        needed = _placeholders(errors["server"][code])
        for params in uses:
            assert needed <= params, f"{code} needs {needed}, one use sends {params}"

    assert not fields - set(errors["fields"]), "add errors.fields.<field> keys"
    assert {kind.value for kind in AccountType} <= set(errors["ledgers"])
