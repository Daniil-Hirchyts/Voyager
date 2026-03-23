from fastapi import APIRouter, Depends
from redis.asyncio import Redis

from app.cache.redis_helpers import build_cache_key, cache_get_json, cache_set_json
from app.config import get_settings
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
    settings = get_settings()
    waypoints_key = "|".join(f"{wp.lat},{wp.lng}" for wp in payload.waypoints)
    cache_key = build_cache_key(
        "route:preview:v1",
        f"{payload.origin.lat},{payload.origin.lng}",
        f"{payload.destination.lat},{payload.destination.lng}",
        waypoints_key,
        payload.travel_mode,
        str(payload.compute_alternatives),
    )
    cached = await cache_get_json(redis, cache_key)
    if cached is not None:
        return RoutePreviewResponse(**cached)
    try:
        routes = await compute_routes(payload)
    except GoogleMapsNotConfiguredError as exc:
        raise _service_unavailable_for_google() from exc
    except GoogleMapsRequestError:
        routes = []
    response = RoutePreviewResponse(routes=routes)
    if routes:
        await cache_set_json(redis, cache_key, response.model_dump(mode="json"), settings.routes_cache_ttl_sec)
    return response


@router.post("/legs", response_model=RouteLegEstimateResponse)
async def estimate_route_legs(
    payload: RouteLegEstimateRequest,
    auth: AuthContext = Depends(get_auth_context),
    redis: Redis = Depends(get_redis),
) -> RouteLegEstimateResponse:
    await limit_user_request(redis, str(auth.user_id), "routes:preview", 120)
    settings = get_settings()
    items: list[RouteLegEstimateItem] = []
    for leg in payload.legs:
        leg_cache_key = build_cache_key(
            "route:leg:v1",
            f"{leg.origin.lat},{leg.origin.lng}",
            f"{leg.destination.lat},{leg.destination.lng}",
            payload.travel_mode,
        )
        cached_leg = await cache_get_json(redis, leg_cache_key)
        if cached_leg is not None:
            items.append(RouteLegEstimateItem(
                from_activity_id=leg.from_activity_id,
                to_activity_id=leg.to_activity_id,
                distance_km=cached_leg.get("distance_km"),
                duration_min=cached_leg.get("duration_min"),
            ))
            continue
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
        if distance_km is not None:
            await cache_set_json(
                redis,
                leg_cache_key,
                {"distance_km": distance_km, "duration_min": duration_min},
                settings.routes_cache_ttl_sec,
            )
        items.append(
            RouteLegEstimateItem(
                from_activity_id=leg.from_activity_id,
                to_activity_id=leg.to_activity_id,
                distance_km=distance_km,
                duration_min=duration_min,
            )
        )
    return RouteLegEstimateResponse(items=items)
