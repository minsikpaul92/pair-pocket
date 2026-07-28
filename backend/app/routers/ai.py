import json
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId

from app.core.security import get_current_user
from app.database import get_database
from app.models.user import UserOut
from app.models.ocr_log import OCRLogOut, FeedbackUpdateBody
from app.services.ai import parse_receipt_or_statement, parse_receipt_or_statement_stream

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
        if not (content_type.startswith("image/") or content_type == "application/pdf"):
            errors.append(f"지원하지 않는 파일 형식입니다 ({file.filename}): {content_type}")
            continue

        try:
            content = await file.read()
            parsed = await parse_receipt_or_statement(
                db, current_user.id, content, content_type, file.filename
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

@router.post("/parse-stream")
async def parse_receipts_or_statements_stream(
    file: UploadFile = File(...),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    content_type = file.content_type or "image/jpeg"
    if not (content_type.startswith("image/") or content_type == "application/pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"지원하지 않는 파일 형식입니다: {content_type}"
        )
    content = await file.read()
    
    async def sse_generator():
        try:
            async for update in parse_receipt_or_statement_stream(
                db, current_user.id, content, content_type, file.filename
            ):
                yield f"data: {json.dumps(update)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'event': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(sse_generator(), media_type="text/event-stream")

def _serialize_log(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "timestamp": doc["timestamp"],
        "file_name": doc["file_name"],
        "model_used": doc.get("model_used"),
        "parsed_data": doc.get("parsed_data"),
        "feedback": doc.get("feedback"),
        "status": doc.get("status"),
        "error_message": doc.get("error_message"),
        "owner_id": doc["owner_id"]
    }

@router.get("/logs", response_model=list[OCRLogOut])
async def list_ocr_logs(
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    from app.services.access import resolve_owner_ids
    from app.models.transaction import AccountType
    
    owner_ids = await resolve_owner_ids(db, current_user, AccountType.SHARED)
    if not owner_ids:
        owner_ids = [current_user.id]
        
    cursor = db["ocr_logs"].find({"owner_id": {"$in": owner_ids}}).sort("timestamp", -1).limit(50)
    logs = await cursor.to_list(length=50)
    return [_serialize_log(l) for l in logs]

@router.patch("/logs/{log_id}/feedback")
async def update_ocr_log_feedback(
    log_id: str,
    body: FeedbackUpdateBody,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    # Validate feedback type
    if body.feedback not in [None, "thumbs_up", "thumbs_down"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Feedback must be 'thumbs_up', 'thumbs_down', or null"
        )
    
    try:
        oid = ObjectId(log_id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid log ID")

    log_doc = await db["ocr_logs"].find_one({"_id": oid})
    if not log_doc:
        raise HTTPException(status_code=status.HTTP_444_NOT_FOUND if hasattr(status, "HTTP_444_NOT_FOUND") else 404, detail="Log not found")
        
    from app.services.access import resolve_owner_ids
    from app.models.transaction import AccountType
    owner_ids = await resolve_owner_ids(db, current_user, AccountType.SHARED)
    if not owner_ids:
        owner_ids = [current_user.id]
        
    if log_doc["owner_id"] not in owner_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    await db["ocr_logs"].update_one(
        {"_id": oid},
        {"$set": {"feedback": body.feedback}}
    )
    return {"status": "success"}
