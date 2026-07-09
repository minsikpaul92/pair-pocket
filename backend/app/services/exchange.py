import datetime

import httpx

# In-memory cache. The rate is refreshed at most once per calendar day
# (per PRD: daily update is enough, real-time is not required).
_cache: dict = {"date": None, "cad_krw": None}

# Reasonable fallback used only if the upstream API is unreachable and the
# cache is empty (approximate CAD -> KRW).
_FALLBACK_CAD_KRW = 1000.0

_FRANKFURTER_URL = "https://api.frankfurter.app/latest"


async def get_cad_krw_rate() -> dict:
    """Return {cad_krw, krw_cad, date, stale} using a once-daily cached value."""
    today = datetime.date.today().isoformat()

    if _cache["date"] == today and _cache["cad_krw"]:
        return _build(_cache["cad_krw"], _cache["date"], stale=False)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                _FRANKFURTER_URL, params={"from": "CAD", "to": "KRW"}
            )
            resp.raise_for_status()
            data = resp.json()
            rate = float(data["rates"]["KRW"])
        _cache["date"] = today
        _cache["cad_krw"] = rate
        return _build(rate, today, stale=False)
    except (httpx.HTTPError, KeyError, ValueError):
        # Serve a stale cached value if we have one; otherwise the fallback.
        if _cache["cad_krw"]:
            return _build(_cache["cad_krw"], _cache["date"], stale=True)
        return _build(_FALLBACK_CAD_KRW, today, stale=True)


def _build(cad_krw: float, date: str | None, *, stale: bool) -> dict:
    return {
        "cad_krw": cad_krw,
        "krw_cad": 1.0 / cad_krw,
        "date": date,
        "stale": stale,
    }
