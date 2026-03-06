import logging
import time
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.cache.redis_helpers import cache_delete_prefix
from app.config import get_settings
from app.db.session import redis_client
from app.errors import TooManyRequestsError
from app.metrics import api_metrics
from app.rate_limit.limiter import limit_ip_request

logger = logging.getLogger(__name__)


class TraceAndLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        trace_id = request.headers.get("x-trace-id", str(uuid.uuid4()))
        request.state.trace_id = trace_id

        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        route = request.scope.get("route")
        route_path = getattr(route, "path", request.url.path)
        api_metrics.observe_request(
            method=request.method,
            path=str(route_path),
            status_code=response.status_code,
            elapsed_ms=elapsed_ms,
        )

        if request.method in {"POST", "PATCH", "DELETE"} and response.status_code < 500:
            await cache_delete_prefix(redis_client, "audit:list:")

        response.headers["x-trace-id"] = trace_id
        logger.info(
            "request_complete",
            extra={
                "trace_id": trace_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )
        return response


class IpRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        settings = get_settings()
        try:
            await limit_ip_request(redis_client, request, settings.rate_limit_ip_per_min)
        except TooManyRequestsError as exc:
            from fastapi.responses import JSONResponse

            trace_id = getattr(request.state, "trace_id", str(uuid.uuid4()))
            return JSONResponse(
                status_code=exc.status_code,
                content={
                    "error": {
                        "code": exc.code,
                        "message": exc.message,
                        "details": exc.details,
                        "trace_id": trace_id,
                    }
                },
            )
        return await call_next(request)
