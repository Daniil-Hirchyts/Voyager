from pydantic import BaseModel


class ErrorData(BaseModel):
    code: str
    message: str
    details: dict | None = None
    trace_id: str


class ErrorEnvelope(BaseModel):
    error: ErrorData
