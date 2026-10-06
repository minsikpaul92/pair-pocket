"""Errors the API reports as codes, never as display text.

Every user-facing error is an `AppError`. The response body is
`{"detail": code, "code": code, "params": {...}}` and the web UI shows
`errors.server.<code>` from its language packs, so each code raised here needs
that key in frontend/messages/ko.json and en.json (tests/test_i18n_packs.py
checks this). See docs/I18N.md.
"""

from __future__ import annotations

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

ParamValue = str | int | float


class AppError(HTTPException):
    """An HTTP error with a camelCase code and optional message params.

    A `field` param names a key under `errors.fields.*` and a `ledger` param a
    key under `errors.ledgers.*`; the UI translates both before formatting.
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        *,
        headers: dict[str, str] | None = None,
        **params: ParamValue,
    ) -> None:
        super().__init__(status_code=status_code, detail=code, headers=headers)
        self.code = code
        self.params = params


def error_body(code: str, params: dict[str, ParamValue] | None = None) -> dict:
    return {"detail": code, "code": code, "params": params or {}}


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        error_body(exc.code, exc.params),
        status_code=exc.status_code,
        headers=exc.headers,
    )
