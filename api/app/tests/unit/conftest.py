import os

from app.config import get_settings

os.environ.setdefault("VOYAGER_DB_DSN", "postgresql+asyncpg://voyager:voyager@localhost:5432/voyager")
os.environ.setdefault("VOYAGER_REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("VOYAGER_KEYCLOAK_ISSUER", "http://localhost:8080/realms/travel")
os.environ.setdefault("VOYAGER_KEYCLOAK_AUDIENCE", "voyager-api")
os.environ.setdefault(
    "VOYAGER_KEYCLOAK_JWKS_URL",
    "http://localhost:8080/realms/travel/protocol/openid-connect/certs",
)
os.environ.setdefault("VOYAGER_KEYCLOAK_CLIENT_ID", "voyager-api")

get_settings.cache_clear()
