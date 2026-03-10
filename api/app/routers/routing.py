from fastapi import APIRouter, Depends
from redis.asyncio import Redis

from app.db.session import get_redis
from app.errors import ServiceUnavailableError
from app.models.routing import (
    RouteLegEstimateItem,
    RouteLegEstimateRequest,
    RouteLegEstimateResponse,
    RoutePreviewRequest,
    RoutePreviewResponse,
)
from app.rate_limit.limiter import limit_user_request
from app.security.dependencies import AuthContext, get_auth_context
from app.services.google_maps import (
    GoogleMapsNotConfiguredError,
    GoogleMapsRequestError,
    compute_route_leg,
    compute_routes,
)

router = APIRouter(prefix="/routes", tags=["routes"])


def _service_unavailable_for_google() -> ServiceUnavailableError:
    return ServiceUnavailableError(
        code="INTEGRATION_NOT_CONFIGURED",
        message="Google Maps integration is unavailable",
        details={"provider": "google_maps"},
    )


@router.post("/preview", response_model=RoutePreviewResponse)
async def preview_routes(
    payload: RoutePreviewRequest,
    auth: AuthContext = Depends(get_auth_context),
    redis: Redis = Depends(get_redis),
) -> RoutePreviewResponse:
    await limit_user_request(redis, str(auth.user_id), "routes:preview", 120)
    try:
        routes = await compute_routes(payload)
    except GoogleMapsNotConfiguredError as exc:
        raise _service_unavailable_for_google() from exc
    except GoogleMapsRequestError:
        routes = []
    return RoutePreviewResponse(routes=routes)


@router.post("/legs", response_model=RouteLegEstimateResponse)
async def estimate_route_legs(
    payload: RouteLegEstimateRequest,
    auth: AuthContext = Depends(get_auth_context),
    redis: Redis = Depends(get_redis),
) -> RouteLegEstimateResponse:
    await limit_user_request(redis, str(auth.user_id), "routes:preview", 120)
    items: list[RouteLegEstimateItem] = []
    for leg in payload.legs:
        try:
            distance_km, duration_min = await compute_route_leg(
                origin=(leg.origin.lat, leg.origin.lng),
                destination=(leg.destination.lat, leg.destination.lng),
                travel_mode=payload.travel_mode,
            )
        except GoogleMapsNotConfiguredError as exc:
            raise _service_unavailable_for_google() from exc
        except GoogleMapsRequestError:
            distance_km, duration_min = None, None
        items.append(
            RouteLegEstimateItem(
                from_activity_id=leg.from_activity_id,
                to_activity_id=leg.to_activity_id,
                distance_km=distance_km,
                duration_min=duration_min,
            )
        )
    return RouteLegEstimateResponse(items=items)
