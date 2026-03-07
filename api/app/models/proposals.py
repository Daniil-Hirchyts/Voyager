from datetime import datetime, time
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class OptimizeObjective(StrEnum):
    BALANCED_FLOW = "balanced_flow"


class TripOptimizeRequest(BaseModel):
    day_ids: list[UUID] | None = None
    activity_snapshot_ids: list[UUID] | None = None
    objective: OptimizeObjective = OptimizeObjective.BALANCED_FLOW
    include_event_candidates: bool = True
    max_event_candidates_per_day: int = Field(default=2, ge=0, le=10)
    constraints: dict = Field(default_factory=dict)


class ProposalActivityResponse(BaseModel):
    id: UUID
    proposal_id: UUID
    trip_day_id: UUID
    source_activity_id: UUID | None
    event_snapshot_id: UUID | None
    place_id: UUID | None
    order_index: int
    title: str
    description: str | None
    start_time: time | None
    duration_min: int | None
    estimated_cost_amount: Decimal | None
    estimated_cost_currency: str | None
    tags: list[str]
    rationale: dict
    score: dict
    created_at: datetime
    updated_at: datetime


class ProposalResponse(BaseModel):
    id: UUID
    trip_id: UUID
    user_id: UUID
    job_id: UUID
    based_on_trip_version: int
    objective: str
    scope_day_ids: list[UUID]
    status: str
    summary: dict
    score: dict
    items: list[ProposalActivityResponse]
    created_at: datetime
    updated_at: datetime


class ProposalListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[ProposalResponse]


class ProposalApplyResponse(BaseModel):
    proposal_id: UUID
    trip_id: UUID
    status: str
    version: int
    applied_day_ids: list[UUID]
