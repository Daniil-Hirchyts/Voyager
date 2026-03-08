from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Voyager API"
    env: str = Field(default="dev", alias="VOYAGER_ENV")
    log_level: str = Field(default="INFO", alias="VOYAGER_LOG_LEVEL")

    db_dsn: str = Field(alias="VOYAGER_DB_DSN")
    redis_url: str = Field(alias="VOYAGER_REDIS_URL")

    keycloak_issuer: str = Field(alias="VOYAGER_KEYCLOAK_ISSUER")
    keycloak_audience: str = Field(alias="VOYAGER_KEYCLOAK_AUDIENCE")
    keycloak_jwks_url: str = Field(alias="VOYAGER_KEYCLOAK_JWKS_URL")
    keycloak_client_id: str = Field(alias="VOYAGER_KEYCLOAK_CLIENT_ID")
    keycloak_client_secret: str | None = Field(default=None, alias="VOYAGER_KEYCLOAK_CLIENT_SECRET")

    require_idempotency_keys: bool = Field(default=True, alias="VOYAGER_REQUIRE_IDEMPOTENCY_KEYS")
    rate_limit_ip_per_min: int = Field(default=240, alias="VOYAGER_RATE_LIMIT_IP_PER_MIN")
    rate_limit_user_per_min: int = Field(default=120, alias="VOYAGER_RATE_LIMIT_USER_PER_MIN")
    rate_limit_trip_create_per_min: int = 20
    rate_limit_activity_create_per_min: int = 60
    rate_limit_generate_per_hour: int = Field(
        default=5, alias="VOYAGER_RATE_LIMIT_GENERATE_PER_HOUR"
    )
    rate_limit_places_geo_per_min: int = Field(
        default=60, alias="VOYAGER_RATE_LIMIT_PLACES_GEO_PER_MIN"
    )
    rate_limit_places_autocomplete_per_min: int = Field(
        default=60, alias="VOYAGER_RATE_LIMIT_PLACES_AUTOCOMPLETE_PER_MIN"
    )
    rate_limit_places_dedup_per_hour: int = Field(
        default=6, alias="VOYAGER_RATE_LIMIT_PLACES_DEDUP_PER_HOUR"
    )
    rate_limit_activities_discover_per_hour: int = Field(
        default=240,
        validation_alias=AliasChoices(
            "VOYAGER_RATE_LIMIT_ACTIVITIES_DISCOVER_PER_HOUR",
            "VOYAGER_RATE_LIMIT_EVENTS_SUBMIT_PER_HOUR",
        ),
    )
    rate_limit_optimize_submit_per_hour: int = Field(
        default=20, alias="VOYAGER_RATE_LIMIT_OPTIMIZE_SUBMIT_PER_HOUR"
    )
    rate_limit_offers_submit_per_hour: int = Field(
        default=20, alias="VOYAGER_RATE_LIMIT_OFFERS_SUBMIT_PER_HOUR"
    )
    rate_limit_export_submit_per_hour: int = Field(
        default=20, alias="VOYAGER_RATE_LIMIT_EXPORT_SUBMIT_PER_HOUR"
    )
    rate_limit_audit_read_per_min: int = Field(
        default=120, alias="VOYAGER_RATE_LIMIT_AUDIT_READ_PER_MIN"
    )
    rate_limit_offers_provider_per_min: int = Field(
        default=120, alias="VOYAGER_RATE_LIMIT_OFFERS_PROVIDER_PER_MIN"
    )

    trip_cache_ttl_sec: int = 30
    place_cache_ttl_sec: int = 60
    job_cache_ttl_sec: int = 5
    activity_cache_ttl_sec: int = Field(
        default=30,
        validation_alias=AliasChoices(
            "VOYAGER_ACTIVITY_CACHE_TTL_SEC",
            "VOYAGER_EVENT_CACHE_TTL_SEC",
        ),
    )
    proposal_cache_ttl_sec: int = Field(default=30, alias="VOYAGER_PROPOSAL_CACHE_TTL_SEC")
    place_photo_cache_ttl_sec: int = Field(
        default=60, alias="VOYAGER_PLACE_PHOTO_CACHE_TTL_SEC"
    )
    offer_cache_ttl_sec: int = Field(default=30, alias="VOYAGER_OFFER_CACHE_TTL_SEC")
    offer_search_cache_ttl_sec: int = Field(default=180, alias="VOYAGER_OFFER_SEARCH_CACHE_TTL_SEC")
    export_cache_ttl_sec: int = Field(default=20, alias="VOYAGER_EXPORT_CACHE_TTL_SEC")
    audit_cache_ttl_sec: int = Field(default=15, alias="VOYAGER_AUDIT_CACHE_TTL_SEC")
    idempotency_ttl_sec: int = 86400
    jwks_cache_ttl_sec: int = 300
    worker_poll_interval_sec: int = Field(default=1, alias="VOYAGER_WORKER_POLL_INTERVAL_SEC")
    job_max_attempts: int = Field(default=3, alias="VOYAGER_JOB_MAX_ATTEMPTS")
    exports_dir: str = Field(default="/var/lib/voyager/exports", alias="VOYAGER_EXPORTS_DIR")
    export_retention_days: int = Field(default=14, alias="VOYAGER_EXPORT_RETENTION_DAYS")
    offers_provider_failure_threshold: int = Field(
        default=3, alias="VOYAGER_OFFERS_PROVIDER_FAILURE_THRESHOLD"
    )
    offers_provider_cooldown_sec: int = Field(
        default=60, alias="VOYAGER_OFFERS_PROVIDER_COOLDOWN_SEC"
    )
    itinerary_llm_enabled: bool = Field(default=True, alias="VOYAGER_ITINERARY_LLM_ENABLED")
    llm_openrouter_api_key: str | None = Field(
        default=None, alias="VOYAGER_LLM_OPENROUTER_API_KEY"
    )
    llm_openrouter_base_url: str = Field(
        default="https://openrouter.ai/api/v1", alias="VOYAGER_LLM_OPENROUTER_BASE_URL"
    )
    llm_openrouter_model_order_raw: str = Field(
        default="openai/gpt-oss-20b:free,qwen/qwen3-coder:free,meta-llama/llama-3.3-70b-instruct:free",
        alias="VOYAGER_LLM_OPENROUTER_MODEL_ORDER",
    )
    llm_openrouter_timeout_sec: int = Field(
        default=20, alias="VOYAGER_LLM_OPENROUTER_TIMEOUT_SEC"
    )
    rate_limit_itinerary_provider_per_min: int = Field(
        default=120, alias="VOYAGER_RATE_LIMIT_ITINERARY_PROVIDER_PER_MIN"
    )

    offers_transport_providers: str = Field(
        default="amadeus_transport",
        alias="VOYAGER_OFFERS_TRANSPORT_PROVIDERS",
    )
    offers_lodging_providers: str = Field(
        default="amadeus_lodging",
        alias="VOYAGER_OFFERS_LODGING_PROVIDERS",
    )

    flights_amadeus_client_id: str | None = Field(
        default=None, alias="VOYAGER_FLIGHTS_AMADEUS_CLIENT_ID"
    )
    flights_amadeus_client_secret: str | None = Field(
        default=None, alias="VOYAGER_FLIGHTS_AMADEUS_CLIENT_SECRET"
    )
    flights_amadeus_base_url: str = Field(
        default="https://test.api.amadeus.com",
        alias="VOYAGER_FLIGHTS_AMADEUS_BASE_URL",
    )
    flights_amadeus_timeout_sec: int = Field(
        default=20,
        alias="VOYAGER_FLIGHTS_AMADEUS_TIMEOUT_SEC",
    )
    activities_tripadvisor_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "VOYAGER_ACTIVITIES_TRIPADVISOR_API_KEY",
            "TRIPADVISOR_SCRAPER_API_KEY",
        ),
    )
    activities_tripadvisor_base_url: str = Field(
        default="https://tripadvisor-scraper-api.omkar.cloud/tripadvisor",
        alias="VOYAGER_ACTIVITIES_TRIPADVISOR_BASE_URL",
    )
    activities_tripadvisor_timeout_sec: int = Field(
        default=20, alias="VOYAGER_ACTIVITIES_TRIPADVISOR_TIMEOUT_SEC"
    )
    media_user_agent: str = Field(
        default="Voyager/0.1 (+https://localhost)",
        alias="VOYAGER_MEDIA_USER_AGENT",
    )
    places_autocomplete_base_url: str = Field(
        default="https://photon.komoot.io/api",
        alias="VOYAGER_PLACES_AUTOCOMPLETE_BASE_URL",
    )
    places_autocomplete_timeout_sec: int = Field(
        default=10,
        alias="VOYAGER_PLACES_AUTOCOMPLETE_TIMEOUT_SEC",
    )
    places_autocomplete_lang: str = Field(
        default="en",
        alias="VOYAGER_PLACES_AUTOCOMPLETE_LANG",
    )
    media_cache_dir: str = Field(
        default="/var/lib/voyager/exports/media-cache",
        alias="VOYAGER_MEDIA_CACHE_DIR",
    )

    def transport_provider_order(self) -> list[str]:
        return [part.strip() for part in self.offers_transport_providers.split(",") if part.strip()]

    def lodging_provider_order(self) -> list[str]:
        return [part.strip() for part in self.offers_lodging_providers.split(",") if part.strip()]

    def itinerary_llm_model_order(self) -> list[str]:
        return [
            part.strip()
            for part in self.llm_openrouter_model_order_raw.split(",")
            if part.strip()
        ]

    @property
    def allowed_audiences(self) -> list[str]:
        return [a.strip() for a in self.keycloak_audience.split(",")]


@lru_cache
def get_settings() -> Settings:
    return Settings()
