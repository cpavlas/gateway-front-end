"""System connectivity health endpoints (/api/v1/system/health and /api/v1/system/ping)."""

from __future__ import annotations

import asyncio
import time
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app import __version__
from app.auth import AuthUserResponse, require_admin_session
from app.clients.elasticsearch import ElasticsearchServiceClient
from app.clients.opnsense import OPNsenseClient, ServiceHealthStatus
from app.config import Settings, get_settings
from app.db import get_db_session

router = APIRouter(prefix="/api/v1/system", tags=["system"])


class SystemHealthResponse(BaseModel):
    """Aggregated system health report for SQLite, OPNsense, and Elasticsearch."""

    overall_status: Literal["healthy", "degraded", "unhealthy"]
    version: str
    services: dict[str, ServiceHealthStatus]


def get_opnsense_client(settings: Settings = Depends(get_settings)) -> OPNsenseClient:
    """FastAPI dependency returning an OPNsenseClient."""
    return OPNsenseClient(settings)


def get_elasticsearch_client(
    settings: Settings = Depends(get_settings),
) -> ElasticsearchServiceClient:
    """FastAPI dependency returning an ElasticsearchServiceClient."""
    return ElasticsearchServiceClient(settings)


async def check_sqlite_health(db: AsyncSession) -> ServiceHealthStatus:
    """Verify local SQLite database responsiveness."""
    start = time.perf_counter()
    try:
        await db.execute(text("SELECT 1"))
        elapsed = round((time.perf_counter() - start) * 1000, 2)
        return ServiceHealthStatus(
            service="sqlite",
            status="healthy",
            latency_ms=elapsed,
            message="Local SQLite database operational.",
        )
    except Exception as exc:
        elapsed = round((time.perf_counter() - start) * 1000, 2)
        return ServiceHealthStatus(
            service="sqlite",
            status="unhealthy",
            latency_ms=elapsed,
            message=f"SQLite health check failed: {exc}",
        )


@router.get("/ping")
async def ping() -> dict[str, str]:
    """Lightweight unauthenticated liveness check for Docker HEALTHCHECK."""
    return {"status": "ok", "version": __version__}


@router.get("/health", response_model=SystemHealthResponse)
async def system_health(
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
    elasticsearch: ElasticsearchServiceClient = Depends(get_elasticsearch_client),
) -> SystemHealthResponse:
    """Check live connectivity and credentials for SQLite, OPNsense, and Elasticsearch."""
    sqlite_status, opnsense_status, es_status = await asyncio.gather(
        check_sqlite_health(db),
        opnsense.check_health(),
        elasticsearch.check_health(),
    )

    statuses = {sqlite_status.status, opnsense_status.status, es_status.status}
    overall: Literal["healthy", "degraded", "unhealthy"]
    if "unhealthy" in statuses:
        overall = "unhealthy"
    elif "degraded" in statuses:
        overall = "degraded"
    else:
        overall = "healthy"

    return SystemHealthResponse(
        overall_status=overall,
        version=__version__,
        services={
            "sqlite": sqlite_status,
            "opnsense": opnsense_status,
            "elasticsearch": es_status,
        },
    )
