from __future__ import annotations

from collections import defaultdict

from redis.asyncio import Redis

REQUEST_DURATION_BUCKETS_MS = (5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000)
JOB_METRIC_EVENTS = ("claimed", "succeeded", "failed", "dead_lettered")
ITINERARY_LLM_EVENTS = ("attempt", "success", "fallback", "failure")


def _escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


class ApiMetricsStore:
    def __init__(self) -> None:
        self.request_total: dict[tuple[str, str, str], int] = defaultdict(int)
        self.request_duration_count: dict[tuple[str, str, str], int] = defaultdict(int)
        self.request_duration_sum_ms: dict[tuple[str, str, str], float] = defaultdict(float)
        self.request_duration_buckets: dict[tuple[str, str, str, str], int] = defaultdict(int)

    def observe_request(self, *, method: str, path: str, status_code: int, elapsed_ms: float) -> None:
        key = (method, path, str(status_code))
        self.request_total[key] += 1
        self.request_duration_count[key] += 1
        self.request_duration_sum_ms[key] += elapsed_ms

        for bound in REQUEST_DURATION_BUCKETS_MS:
            if elapsed_ms <= bound:
                self.request_duration_buckets[(method, path, str(status_code), str(bound))] += 1
        self.request_duration_buckets[(method, path, str(status_code), "+Inf")] += 1

    async def render_prometheus(
        self,
        *,
        redis: Redis | None,
        job_queue_pending: int,
        job_queue_running: int,
    ) -> str:
        lines: list[str] = []
        lines.append("# HELP voyager_http_requests_total Total HTTP requests.")
        lines.append("# TYPE voyager_http_requests_total counter")
        for (method, path, status), value in sorted(self.request_total.items()):
            lines.append(
                f'voyager_http_requests_total{{method="{_escape_label(method)}",path="{_escape_label(path)}",status="{_escape_label(status)}"}} {value}'
            )

        lines.append(
            "# HELP voyager_http_request_duration_ms Request duration in milliseconds (histogram)."
        )
        lines.append("# TYPE voyager_http_request_duration_ms histogram")
        for (method, path, status, le), value in sorted(self.request_duration_buckets.items()):
            lines.append(
                f'voyager_http_request_duration_ms_bucket{{method="{_escape_label(method)}",path="{_escape_label(path)}",status="{_escape_label(status)}",le="{_escape_label(le)}"}} {value}'
            )
        for (method, path, status), value in sorted(self.request_duration_count.items()):
            sum_value = self.request_duration_sum_ms[(method, path, status)]
            lines.append(
                f'voyager_http_request_duration_ms_sum{{method="{_escape_label(method)}",path="{_escape_label(path)}",status="{_escape_label(status)}"}} {sum_value:.6f}'
            )
            lines.append(
                f'voyager_http_request_duration_ms_count{{method="{_escape_label(method)}",path="{_escape_label(path)}",status="{_escape_label(status)}"}} {value}'
            )

        lines.append("# HELP voyager_worker_jobs_total Worker job lifecycle event totals.")
        lines.append("# TYPE voyager_worker_jobs_total counter")
        job_metrics = await get_job_metric_counts(redis)
        for event in JOB_METRIC_EVENTS:
            lines.append(
                f'voyager_worker_jobs_total{{event="{_escape_label(event)}"}} {job_metrics.get(event, 0)}'
            )

        lines.append("# HELP voyager_job_queue_depth Current job queue depth by status.")
        lines.append("# TYPE voyager_job_queue_depth gauge")
        lines.append(f'voyager_job_queue_depth{{status="PENDING"}} {job_queue_pending}')
        lines.append(f'voyager_job_queue_depth{{status="RUNNING"}} {job_queue_running}')

        lines.append("# HELP voyager_itinerary_llm_total Itinerary LLM attempt/fallback counters.")
        lines.append("# TYPE voyager_itinerary_llm_total counter")
        llm_metrics = await get_itinerary_llm_metric_counts(redis)
        for event in ITINERARY_LLM_EVENTS:
            lines.append(
                f'voyager_itinerary_llm_total{{event="{_escape_label(event)}"}} {llm_metrics.get(event, 0)}'
            )
        return "\n".join(lines) + "\n"


api_metrics = ApiMetricsStore()


async def increment_job_metric(redis: Redis | None, event: str) -> None:
    if redis is None:
        return
    if event not in JOB_METRIC_EVENTS:
        return
    await redis.incr(f"metrics:jobs:{event}")


async def get_job_metric_counts(redis: Redis | None) -> dict[str, int]:
    if redis is None:
        return {event: 0 for event in JOB_METRIC_EVENTS}

    keys = [f"metrics:jobs:{event}" for event in JOB_METRIC_EVENTS]
    values = await redis.mget(keys)
    result: dict[str, int] = {}
    for event, raw in zip(JOB_METRIC_EVENTS, values, strict=True):
        try:
            result[event] = int(raw) if raw is not None else 0
        except ValueError:
            result[event] = 0
    return result


async def increment_itinerary_llm_metric(redis: Redis | None, event: str) -> None:
    if redis is None:
        return
    if event not in ITINERARY_LLM_EVENTS:
        return
    await redis.incr(f"metrics:itinerary_llm:{event}")


async def get_itinerary_llm_metric_counts(redis: Redis | None) -> dict[str, int]:
    if redis is None:
        return {event: 0 for event in ITINERARY_LLM_EVENTS}

    keys = [f"metrics:itinerary_llm:{event}" for event in ITINERARY_LLM_EVENTS]
    values = await redis.mget(keys)
    result: dict[str, int] = {}
    for event, raw in zip(ITINERARY_LLM_EVENTS, values, strict=True):
        try:
            result[event] = int(raw) if raw is not None else 0
        except ValueError:
            result[event] = 0
    return result


def clear_metrics_state() -> None:
    api_metrics.request_total.clear()
    api_metrics.request_duration_count.clear()
    api_metrics.request_duration_sum_ms.clear()
    api_metrics.request_duration_buckets.clear()
