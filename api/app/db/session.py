from collections.abc import AsyncIterator

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.db_dsn,
    pool_pre_ping=True,
    pool_size=20,
    max_overflow=20,
)
AsyncSessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False, class_=AsyncSession)
redis_client = Redis.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)


async def get_db_session() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_redis() -> AsyncIterator[Redis]:
    yield redis_client
