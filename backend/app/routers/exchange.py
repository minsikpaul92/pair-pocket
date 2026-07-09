from fastapi import APIRouter, Depends

from app.core.security import get_current_user
from app.models.user import UserOut
from app.services.exchange import get_cad_krw_rate

router = APIRouter(prefix="/api/exchange-rate", tags=["exchange"])


@router.get("")
async def exchange_rate(_: UserOut = Depends(get_current_user)) -> dict:
    """Current CAD<->KRW rate (cached once daily)."""
    return await get_cad_krw_rate()
