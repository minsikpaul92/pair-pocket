from datetime import datetime
from pydantic import BaseModel, Field

class OCRLogBase(BaseModel):
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    file_name: str
    model_used: str | None = None
    parsed_data: dict | list | None = None
    feedback: str | None = None  # "thumbs_up", "thumbs_down", or None
    status: str = "success"  # "success" or "failed"
    error_message: str | None = None

class OCRLogOut(OCRLogBase):
    id: str
    owner_id: str

class FeedbackUpdateBody(BaseModel):
    feedback: str | None = None  # "thumbs_up" or "thumbs_down" or None
