import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.errors import ApiError
from app.logging import attach_trace_filter, configure_logging
from app.middleware import IpRateLimitMiddleware, TraceAndLoggingMiddleware
from app.routers import (
    activities,
    days,
    exports,
    health,
    jobs,
    map_layers,
    offers,
    places,
    proposals,
    routing,
    trips,
    users,
)

configure_logging()
attach_trace_filter()
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Voyager API",
    version="0.1.0",
    description="Local-first backend for interactive trip planning",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://voyager.local",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|voyager\.local)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, exc: ApiError):
    trace_id = getattr(request.state, "trace_id", "-")
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


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    trace_id = getattr(request.state, "trace_id", "-")
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Invalid request payload",
                "details": {"errors": exc.errors()},
                "trace_id": trace_id,
            }
        },
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    trace_id = getattr(request.state, "trace_id", "-")
    logger.exception("unhandled_error", extra={"trace_id": trace_id})
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "Unexpected server error",
                "details": None,
                "trace_id": trace_id,
            }
        },
    )


app.add_middleware(TraceAndLoggingMiddleware)
app.add_middleware(IpRateLimitMiddleware)

app.include_router(health.router)
app.include_router(users.router)
app.include_router(trips.router)
app.include_router(days.router)
app.include_router(activities.router)
app.include_router(places.router)
app.include_router(routing.router)
app.include_router(map_layers.router)
app.include_router(proposals.router)
app.include_router(jobs.router)
app.include_router(offers.router)
app.include_router(exports.router)
