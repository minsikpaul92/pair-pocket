import json
from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId

from app.core.errors import AppError
from app.core.security import get_current_user
from app.database import get_database
from app.models.user import UserOut
from app.models.ocr_log import OCRLogOut, FeedbackUpdateBody
from app.services.ai import (
    ONBOARDING_MAX_IMAGES,
    ONBOARDING_STEPS,
    ScanError,
    parse_files_in_batches,
    parse_onboarding_screenshots,
    parse_onboarding_screenshots_stream,
    parse_receipt_or_statement_stream,
    parse_receipt_items,
)

router = APIRouter(prefix="/api/ai", tags=["ai"])


def _error_event(exc: Exception) -> dict:
    """Stream event for an unexpected failure; the UI shows errors.server.<code>."""
    return {
        "event": "error",
        "code": getattr(exc, "code", "aiScanFailed"),
        "error": str(exc),
    }


@router.post("/parse")
async def parse_receipts_or_statements(
    files: list[UploadFile] = File(...),
    flow_type: str = Query("expense", description="expense | income"),
    retry_count: int = Query(0, description="Retry count for model escalation"),
    force_model: str | None = Query(None, description="Force specific Gemini model"),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    prepared: list[tuple[bytes, str, str]] = []
    errors: list[str] = []
    error_codes: list[str] = []
    normalized_flow = flow_type.strip().lower()
    if normalized_flow not in ("expense", "income"):
        raise AppError(status.HTTP_400_BAD_REQUEST, "invalidScanType")

    for file in files:
        content_type = file.content_type or "image/jpeg"
        if not (content_type.startswith("image/") or content_type == "application/pdf"):
            errors.append(f"{file.filename}: unsupported file type {content_type}")
            error_codes.append("unsupportedFileType")
            continue
        content = await file.read()
        prepared.append((content, content_type, file.filename or "file"))

    outcomes = await parse_files_in_batches(
        db,
        current_user.id,
        prepared,
        flow_type=normalized_flow,
        retry_count=retry_count,
        force_model=force_model,
    )
    results = []
    for item in outcomes:
        if "error" in item:
            errors.append(f"{item['file_name']}: {item['error']}")
            error_codes.append(item["code"])
            continue
        parsed = item["result"]
        parsed["file_name"] = item["file_name"]
        results.append(parsed)

    if errors and not results:
        # One shared reason (no API key, say) is worth showing as is.
        code = error_codes[0] if len(set(error_codes)) == 1 else "aiScanFailed"
        raise AppError(status.HTTP_400_BAD_REQUEST, code)

    return {
        "status": "success",
        "results": results,
        "errors": errors if errors else None,
    }


@router.post("/parse-items")
async def parse_items_endpoint(
    file: UploadFile = File(...),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    content_type = file.content_type or "image/jpeg"
    if not (content_type.startswith("image/") or content_type == "application/pdf"):
        raise AppError(status.HTTP_400_BAD_REQUEST, "unsupportedFileType")
    content = await file.read()
    items = await parse_receipt_items(
        db, current_user.id, content, content_type, file.filename or "file"
    )
    return {"status": "success", "items": items}


@router.post("/parse-stream")
async def parse_receipts_or_statements_stream(
    file: UploadFile = File(...),
    flow_type: str = Query("expense", description="expense | income"),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    content_type = file.content_type or "image/jpeg"
    if not (content_type.startswith("image/") or content_type == "application/pdf"):
        raise AppError(status.HTTP_400_BAD_REQUEST, "unsupportedFileType")
    normalized_flow = flow_type.strip().lower()
    if normalized_flow not in ("expense", "income"):
        raise AppError(status.HTTP_400_BAD_REQUEST, "invalidScanType")
    content = await file.read()

    async def sse_generator():
        try:
            async for update in parse_receipt_or_statement_stream(
                db,
                current_user.id,
                content,
                content_type,
                file.filename,
                flow_type=normalized_flow,
            ):
                yield f"data: {json.dumps(update)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps(_error_event(e))}\n\n"

    return StreamingResponse(sse_generator(), media_type="text/event-stream")


async def _read_onboarding_images(
    step: str, files: list[UploadFile]
) -> list[tuple[bytes, str, str]]:
    if step not in ONBOARDING_STEPS:
        raise AppError(status.HTTP_400_BAD_REQUEST, "invalidOnboardingStep")
    if not files:
        raise AppError(status.HTTP_400_BAD_REQUEST, "imagesRequired")
    if len(files) > ONBOARDING_MAX_IMAGES:
        raise AppError(
            status.HTTP_400_BAD_REQUEST, "tooManyImages", max=ONBOARDING_MAX_IMAGES
        )

    prepared: list[tuple[bytes, str, str]] = []
    for file in files:
        content_type = file.content_type or "image/jpeg"
        if not content_type.startswith("image/"):
            raise AppError(status.HTTP_400_BAD_REQUEST, "unsupportedFileType")
        content = await file.read()
        prepared.append((content, content_type, file.filename or "image.jpg"))
    return prepared


@router.post("/onboarding-parse")
async def parse_onboarding_step_screenshots(
    step: str = Query(..., description="assets | subscriptions | brokerage"),
    files: list[UploadFile] = File(...),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    prepared = await _read_onboarding_images(step, files)
    try:
        result = await parse_onboarding_screenshots(db, current_user.id, step, prepared)
    except ScanError as e:
        raise AppError(status.HTTP_400_BAD_REQUEST, e.code, **e.params) from e
    except Exception as e:
        raise AppError(status.HTTP_400_BAD_REQUEST, "aiScanFailed") from e

    return {"status": "success", **result}


@router.post("/onboarding-parse-stream")
async def parse_onboarding_step_screenshots_stream(
    step: str = Query(..., description="assets | subscriptions | brokerage"),
    files: list[UploadFile] = File(...),
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    prepared = await _read_onboarding_images(step, files)

    async def sse_generator():
        try:
            async for update in parse_onboarding_screenshots_stream(
                db, current_user.id, step, prepared
            ):
                yield f"data: {json.dumps(update)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps(_error_event(e))}\n\n"

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
        "owner_id": doc["owner_id"],
    }


@router.get("/logs", response_model=list[OCRLogOut])
async def list_ocr_logs(
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    cursor = (
        db["ocr_logs"]
        .find({"owner_id": current_user.id})
        .sort("timestamp", -1)
        .limit(50)
    )
    logs = await cursor.to_list(length=50)
    return [_serialize_log(log) for log in logs]


@router.patch("/logs/{log_id}/feedback")
async def update_ocr_log_feedback(
    log_id: str,
    body: FeedbackUpdateBody,
    current_user: UserOut = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    # Validate feedback type
    if body.feedback not in [None, "thumbs_up", "thumbs_down"]:
        raise AppError(status.HTTP_400_BAD_REQUEST, "invalidFeedback")

    try:
        oid = ObjectId(log_id)
    except Exception:
        raise AppError(status.HTTP_400_BAD_REQUEST, "notFound")

    log_doc = await db["ocr_logs"].find_one({"_id": oid})
    if not log_doc:
        raise AppError(status.HTTP_404_NOT_FOUND, "notFound")

    if log_doc["owner_id"] != current_user.id:
        raise AppError(status.HTTP_403_FORBIDDEN, "accessDenied")

    await db["ocr_logs"].update_one({"_id": oid}, {"$set": {"feedback": body.feedback}})
    return {"status": "success"}
