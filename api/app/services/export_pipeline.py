from __future__ import annotations

import hashlib
import os
import uuid
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import Job
from app.db.repositories import ExportRepository, TripRepository
from app.errors import NotFoundError
from app.services.export_pipeline_common import _as_format, _as_uuid
from app.services.export_pipeline_formats import _content_type_for, _materialize_bytes
from app.services.export_pipeline_payload import _load_trip_payload
from app.services.itinerary_generation import NonRetryableJobError

settings = get_settings()


@dataclass
class ExportExecutionResult:
    export_id: str
    format: str
    trip_version: int
    sha256: str
    size_bytes: int
    content_type: str


def _target_path(
    *, user_id: uuid.UUID, trip_id: uuid.UUID, export_id: uuid.UUID, format_name: str
) -> Path:
    root = Path(settings.exports_dir)
    return root / str(user_id) / str(trip_id) / f"{export_id}.{format_name}"


def _write_file_atomically(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("wb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp_path, path)


async def execute_export_job(db: AsyncSession, job: Job) -> ExportExecutionResult:
    payload = job.payload_json
    if not isinstance(payload, dict):
        raise NonRetryableJobError("JOB_PAYLOAD_INVALID", "Job payload must be an object")

    export_id = _as_uuid(payload.get("export_id"), field="export_id")
    trip_id = _as_uuid(payload.get("trip_id"), field="trip_id")
    user_id = _as_uuid(payload.get("user_id"), field="user_id")
    expected_version = int(payload.get("expected_trip_version"))
    format_name = _as_format(payload.get("format"))

    try:
        trip = await TripRepository.get_trip(db, user_id, trip_id)
    except NotFoundError:
        raise NonRetryableJobError("RESOURCE_NOT_FOUND", "Trip not found for export job") from None
    if trip.version != expected_version:
        raise NonRetryableJobError(
            "CONFLICT_VERSION_MISMATCH",
            "Trip version mismatch",
            {"latest_version": trip.version},
        )

    payload_obj = await _load_trip_payload(db, trip=trip)
    content = _materialize_bytes(format_name, payload_obj)
    digest = hashlib.sha256(content).hexdigest()
    file_path = _target_path(
        user_id=user_id, trip_id=trip_id, export_id=export_id, format_name=format_name
    )
    _write_file_atomically(file_path, content)

    content_type = _content_type_for(format_name)
    await ExportRepository.mark_export_succeeded(
        db,
        export_id=export_id,
        file_path=str(file_path),
        content_type=content_type,
        size_bytes=len(content),
        sha256=digest,
    )
    return ExportExecutionResult(
        export_id=str(export_id),
        format=format_name,
        trip_version=trip.version,
        sha256=digest,
        size_bytes=len(content),
        content_type=content_type,
    )
