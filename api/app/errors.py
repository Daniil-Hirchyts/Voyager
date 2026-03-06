from dataclasses import dataclass


@dataclass
class ApiError(Exception):
    status_code: int
    code: str
    message: str
    details: dict | None = None


class UnauthorizedError(ApiError):
    def __init__(self, message: str = "Unauthorized", details: dict | None = None) -> None:
        super().__init__(
            status_code=401, code="AUTH_INVALID_TOKEN", message=message, details=details
        )


class ForbiddenError(ApiError):
    def __init__(self, message: str = "Forbidden", details: dict | None = None) -> None:
        super().__init__(status_code=403, code="AUTH_FORBIDDEN", message=message, details=details)


class NotFoundError(ApiError):
    def __init__(self, message: str = "Not found", details: dict | None = None) -> None:
        super().__init__(
            status_code=404, code="RESOURCE_NOT_FOUND", message=message, details=details
        )


class ConflictError(ApiError):
    def __init__(self, code: str, message: str, details: dict | None = None) -> None:
        super().__init__(status_code=409, code=code, message=message, details=details)


class ValidationApiError(ApiError):
    def __init__(self, message: str, details: dict | None = None) -> None:
        super().__init__(status_code=422, code="VALIDATION_ERROR", message=message, details=details)


class TooManyRequestsError(ApiError):
    def __init__(self, message: str, details: dict | None = None) -> None:
        super().__init__(
            status_code=429, code="RATE_LIMIT_EXCEEDED", message=message, details=details
        )


class ServiceUnavailableError(ApiError):
    def __init__(self, code: str, message: str, details: dict | None = None) -> None:
        super().__init__(status_code=503, code=code, message=message, details=details)
