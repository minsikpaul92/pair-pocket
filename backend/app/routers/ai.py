from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.security import get_current_user
from app.database import get_database
from app.models.user import UserOut
from app.services.ai import parse_receipt_or_statement

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.post("/parse")
async def parse_receipts_or_statements(
    files: list[UploadFile] = File(...),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    results = []
    errors = []

    for file in files:
        content_type = file.content_type or "image/jpeg"
        # Validate mime type
        if not (content_type.startswith("image/") or content_type == "application/pdf"):
            errors.append(f"지원하지 않는 파일 형식입니다 ({file.filename}): {content_type}")
            continue

        try:
            content = await file.read()
            parsed = await parse_receipt_or_statement(
                db, current_user.id, content, content_type
            )
            parsed["file_name"] = file.filename
            results.append(parsed)
        except Exception as e:
            errors.append(f"파일 분석 중 오류 발생 ({file.filename}): {str(e)}")

    if errors and not results:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="; ".join(errors)
        )

    return {
        "status": "success",
        "results": results,
        "errors": errors if errors else None
    }
