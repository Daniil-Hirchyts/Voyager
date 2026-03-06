import uuid

from fastapi import APIRouter, Depends
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.redis_helpers import cache_delete_prefix
from app.db.repositories import DayRepository
from app.db.session import get_db_session, get_redis
from app.models.trips import DayPatchRequest, DayResponse
from app.security.dependencies import AuthContext, get_auth_context

router = APIRouter(prefix="/days", tags=["days"])


@router.patch("/{day_id}", response_model=DayResponse)
async def patch_day(
    day_id: uuid.UUID,
    payload: DayPatchRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db_session),
    redis: Redis = Depends(get_redis),
) -> DayResponse:
    day = await DayRepository.patch_day(db, auth.user_id, day_id, payload)
    await cache_delete_prefix(redis, "trip:get:")
    await cache_delete_prefix(redis, "trip:list:")
    return DayResponse(
        id=day.id,
        trip_id=day.trip_id,
        day_index=day.day_index,
        date=day.date,
        notes=day.notes,
        created_at=day.created_at,
        updated_at=day.updated_at,
    )
