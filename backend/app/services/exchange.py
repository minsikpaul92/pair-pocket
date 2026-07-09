"""CAD ↔ KRW exchange rate with once-daily cache.

Primary: Frankfurter (ECB-based, free, no key) — api.frankfurter.dev
Fallback: open.er-api.com (daily update, free, no key)
Last resort: approximate constant (only if both fail and cache empty).
"""

import datetime

import httpx

_cache: dict = {"date": None, "cad_krw": None, "source": None}

# Used only when every upstream fails and there is no cached value.
_FALLBACK_CAD_KRW = 1000.0

_FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest"
_ER_API_URL = "https://open.er-api.com/v6/latest/CAD"


async def get_cad_krw_rate() -> dict:
    """Return {cad_krw, krw_cad, date, stale, source} cached once per day."""
    today = datetime.date.today().isoformat()

    if _cache["date"] == today and _cache["cad_krw"]:
        return _build(
            _cache["cad_krw"],
            _cache["date"],
            stale=False,
            source=_cache.get("source") or "cache",
        )

    rate, source, as_of = await _fetch_live_rate()
    if rate is not None:
        _cache["date"] = as_of or today
        _cache["cad_krw"] = rate
        _cache["source"] = source
        return _build(rate, _cache["date"], stale=False, source=source)

    if _cache["cad_krw"]:
        return _build(
            _cache["cad_krw"],
            _cache["date"],
            stale=True,
            source=_cache.get("source") or "cache",
        )
    return _build(_FALLBACK_CAD_KRW, today, stale=True, source="fallback")


async def _fetch_live_rate() -> tuple[float | None, str | None, str | None]:
    """Try Frankfurter first, then open.er-api. Returns (rate, source, date)."""
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        # 1) Frankfurter (central-bank mid rates)
        try:
            resp = await client.get(
                _FRANKFURTER_URL, params={"base": "CAD", "symbols": "KRW"}
            )
            resp.raise_for_status()
            data = resp.json()
            rate = float(data["rates"]["KRW"])
            as_of = data.get("date") or datetime.date.today().isoformat()
            return rate, "frankfurter", as_of
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            pass

        # 2) open.er-api.com (daily, no key)
        try:
            resp = await client.get(_ER_API_URL)
            resp.raise_for_status()
            data = resp.json()
            if data.get("result") != "success":
                raise ValueError("er-api unsuccessful")
            rate = float(data["rates"]["KRW"])
            as_of = datetime.date.today().isoformat()
            utc = data.get("time_last_update_utc")
            if isinstance(utc, str) and len(utc) >= 16:
                # "Thu, 09 Jul 2026 00:02:32 +0000" → keep YYYY-MM-DD via unix if present
                unix = data.get("time_last_update_unix")
                if isinstance(unix, (int, float)):
                    as_of = datetime.datetime.utcfromtimestamp(unix).date().isoformat()
            return rate, "exchangerate-api", as_of
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            pass

    return None, None, None


def _build(
    cad_krw: float, date: str | None, *, stale: bool, source: str
) -> dict:
    return {
        "cad_krw": cad_krw,
        "krw_cad": 1.0 / cad_krw,
        "date": date,
        "stale": stale,
        "source": source,
    }
