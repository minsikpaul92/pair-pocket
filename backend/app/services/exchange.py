"""CAD ↔ KRW ↔ USD exchange rate with once-daily cache.

Primary: Frankfurter (ECB-based, free, no key) — api.frankfurter.dev
Fallback: open.er-api.com (daily update, free, no key)
Last resort: approximate constant.
"""

import datetime
import httpx

_cache: dict = {
    "date": None,
    "cad_krw": None,
    "usd_krw": None,
    "usd_cad": None,
    "source": None,
}

# Used only when every upstream fails and there is no cached value.
_FALLBACK_CAD_KRW = 1000.0
_FALLBACK_USD_KRW = 1350.0
_FALLBACK_USD_CAD = 1.35

_FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest"
_ER_API_URL = "https://open.er-api.com/v6/latest/USD"


async def get_cad_krw_rate() -> dict:
    """Return exchange rates dict with USD, CAD, KRW cached once per day."""
    today = datetime.date.today().isoformat()

    if _cache["date"] == today and _cache["cad_krw"]:
        return _build(
            _cache["cad_krw"],
            _cache["usd_krw"],
            _cache["usd_cad"],
            _cache["date"],
            stale=False,
            source=_cache.get("source") or "cache",
        )

    rates, source, as_of = await _fetch_live_rates()
    if rates is not None:
        usd_cad = rates["usd_cad"]
        usd_krw = rates["usd_krw"]
        cad_krw = usd_krw / usd_cad

        _cache["date"] = as_of or today
        _cache["cad_krw"] = cad_krw
        _cache["usd_krw"] = usd_krw
        _cache["usd_cad"] = usd_cad
        _cache["source"] = source
        return _build(cad_krw, usd_krw, usd_cad, _cache["date"], stale=False, source=source)

    if _cache["cad_krw"]:
        return _build(
            _cache["cad_krw"],
            _cache["usd_krw"],
            _cache["usd_cad"],
            _cache["date"],
            stale=True,
            source=_cache.get("source") or "cache",
        )
    return _build(
        _FALLBACK_CAD_KRW,
        _FALLBACK_USD_KRW,
        _FALLBACK_USD_CAD,
        today,
        stale=True,
        source="fallback",
    )


async def _fetch_live_rates() -> tuple[dict | None, str | None, str | None]:
    """Try Frankfurter first (base=USD), then open.er-api (base=USD). Returns (rates_dict, source, date)."""
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        # 1) Frankfurter (base=USD)
        try:
            resp = await client.get(
                _FRANKFURTER_URL, params={"base": "USD", "symbols": "CAD,KRW"}
            )
            resp.raise_for_status()
            data = resp.json()
            rates = {
                "usd_cad": float(data["rates"]["CAD"]),
                "usd_krw": float(data["rates"]["KRW"]),
            }
            as_of = data.get("date") or datetime.date.today().isoformat()
            return rates, "frankfurter", as_of
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            pass

        # 2) open.er-api.com (base=USD)
        try:
            resp = await client.get(_ER_API_URL)
            resp.raise_for_status()
            data = resp.json()
            if data.get("result") != "success":
                raise ValueError("er-api unsuccessful")
            rates = {
                "usd_cad": float(data["rates"]["CAD"]),
                "usd_krw": float(data["rates"]["KRW"]),
            }
            as_of = datetime.date.today().isoformat()
            return rates, "exchangerate-api", as_of
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            pass

    return None, None, None


def _build(
    cad_krw: float, usd_krw: float, usd_cad: float, date: str | None, *, stale: bool, source: str
) -> dict:
    return {
        "cad_krw": cad_krw,
        "krw_cad": 1.0 / cad_krw,
        "usd_krw": usd_krw,
        "krw_usd": 1.0 / usd_krw,
        "usd_cad": usd_cad,
        "cad_usd": 1.0 / usd_cad,
        "date": date,
        "stale": stale,
        "source": source,
    }
