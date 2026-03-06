import logging
import sys

from app.config import get_settings


def configure_logging() -> None:
    settings = get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s trace_id=%(trace_id)s %(message)s",
        stream=sys.stdout,
    )


class TraceIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "trace_id"):
            record.trace_id = "-"
        return True


def attach_trace_filter() -> None:
    root_logger = logging.getLogger()
    trace_filter = TraceIdFilter()
    for handler in root_logger.handlers:
        handler.addFilter(trace_filter)
