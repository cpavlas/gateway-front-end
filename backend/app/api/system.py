"""System connectivity health endpoints (/api/v1/system/health and /api/v1/system/ping)."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app import __version__
from app.auth import AuthUserResponse, require_admin_session
from app.clients.elasticsearch import ElasticsearchServiceClient
from app.clients.opnsense import OPNsenseClient, ServiceHealthStatus
from app.config import Settings, get_settings
from app.db import get_db_session
from app.services.audit_and_backup_service import (
    AuditLogListResponse,
    ConfigBackupPayload,
    ConfigRestoreSummary,
    export_configuration_backup,
    list_audit_logs,
    restore_configuration_backup,
)

router = APIRouter(prefix="/api/v1/system", tags=["system"])
audit_router = APIRouter(prefix="/api/v1/audit-logs", tags=["audit"])


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


def format_storage_size(size_bytes: int) -> str:
    """Format a byte count into a human-readable storage string (B, KB, MB)."""
    safe_bytes = max(0, int(size_bytes))
    if safe_bytes < 1024:
        return f"{safe_bytes} B"
    if safe_bytes < 1024 * 1024:
        return f"{safe_bytes / 1024:.1f} KB"
    return f"{safe_bytes / (1024 * 1024):.2f} MB"


def compute_sqlite_file_bytes(sqlite_db_path: str | None, pragma_bytes: int = 0) -> int:
    """Compute on-disk SQLite size including WAL and SHM files, falling back to PRAGMA bytes."""
    total_disk_bytes = 0
    if sqlite_db_path and sqlite_db_path.strip() and sqlite_db_path.strip() != ":memory:":
        base_path = Path(sqlite_db_path.strip())
        for candidate in (
            base_path,
            Path(f"{base_path}-wal"),
            Path(f"{base_path}-shm"),
        ):
            try:
                if candidate.is_file():
                    total_disk_bytes += candidate.stat().st_size
            except OSError:
                continue
    if total_disk_bytes > 0:
        return total_disk_bytes
    return max(0, int(pragma_bytes))


def build_sqlite_health_details(
    *,
    sqlite_db_path: str | None,
    pragma_bytes: int,
    counts: dict[str, int],
) -> dict[str, Any]:
    """Assemble standardized SQLite storage and record count details (`FB-P6-003`)."""
    devices_count = int(counts.get("devices_count", 0))
    groups_count = int(counts.get("groups_count", 0))
    timers_count = int(counts.get("timers_count", 0))
    schedules_count = int(counts.get("schedules_count", 0))
    audit_logs_count = int(counts.get("audit_logs_count", 0))
    total_records = (
        devices_count + groups_count + timers_count + schedules_count + audit_logs_count
    )
    storage_bytes = compute_sqlite_file_bytes(sqlite_db_path, pragma_bytes=pragma_bytes)
    return {
        "storage_bytes": storage_bytes,
        "storage_size_formatted": format_storage_size(storage_bytes),
        "total_records": total_records,
        "devices_count": devices_count,
        "groups_count": groups_count,
        "timers_count": timers_count,
        "schedules_count": schedules_count,
        "audit_logs_count": audit_logs_count,
    }


async def check_sqlite_health(
    db: AsyncSession,
    settings: Settings | None = None,
) -> ServiceHealthStatus:
    """Verify local SQLite database responsiveness and gather storage & record telemetry."""
    start = time.perf_counter()
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:
        elapsed = round((time.perf_counter() - start) * 1000, 2)
        return ServiceHealthStatus(
            service="sqlite",
            status="unhealthy",
            latency_ms=elapsed,
            message=f"SQLite health check failed: {exc}",
        )

    counts: dict[str, int] = {
        "devices_count": 0,
        "groups_count": 0,
        "timers_count": 0,
        "schedules_count": 0,
        "audit_logs_count": 0,
    }
    pragma_bytes = 0
    try:
        stats_row = (
            await db.execute(
                text(
                    "SELECT "
                    "(SELECT COUNT(*) FROM devices) AS devices_count, "
                    "(SELECT COUNT(*) FROM device_groups) AS groups_count, "
                    "(SELECT COUNT(*) FROM temporary_overrides) AS timers_count, "
                    "(SELECT COUNT(*) FROM schedules) AS schedules_count, "
                    "(SELECT COUNT(*) FROM audit_logs) AS audit_logs_count, "
                    "(SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()) "
                    "AS pragma_bytes"
                )
            )
        ).first()
        if stats_row is not None:
            counts["devices_count"] = int(stats_row[0] or 0)
            counts["groups_count"] = int(stats_row[1] or 0)
            counts["timers_count"] = int(stats_row[2] or 0)
            counts["schedules_count"] = int(stats_row[3] or 0)
            counts["audit_logs_count"] = int(stats_row[4] or 0)
            pragma_bytes = int(stats_row[5] or 0)
    except Exception:
        pass

    db_path = settings.sqlite_db_path if settings is not None else None
    details = build_sqlite_health_details(
        sqlite_db_path=db_path,
        pragma_bytes=pragma_bytes,
        counts=counts,
    )
    elapsed = round((time.perf_counter() - start) * 1000, 2)
    return ServiceHealthStatus(
        service="sqlite",
        status="healthy",
        latency_ms=elapsed,
        message="Local SQLite database operational.",
        details=details,
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
    settings: Settings = Depends(get_settings),
) -> SystemHealthResponse:
    """Check live connectivity and credentials for SQLite, OPNsense, and Elasticsearch."""
    sqlite_status, opnsense_status, es_status = await asyncio.gather(
        check_sqlite_health(db, settings),
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


@audit_router.get("", response_model=AuditLogListResponse)
@router.get("/audit-logs", response_model=AuditLogListResponse)
async def get_audit_logs(
    action: str | None = Query(default=None, description="Filter by action prefix/substring."),
    search: str | None = Query(default=None, description="Search actor, target, or details."),
    limit: int = Query(default=50, ge=1, le=250),
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
) -> AuditLogListResponse:
    """List audit history records with optional action/search filter and 90d pruning."""
    return await list_audit_logs(db, action_filter=action, search=search, limit=limit)


@router.get("/backup", response_model=ConfigBackupPayload)
async def get_system_backup(
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
) -> ConfigBackupPayload:
    """Export device customizations, groups, and schedules as a portable JSON snapshot."""
    return await export_configuration_backup(db)


@router.post("/restore", response_model=ConfigRestoreSummary)
async def post_system_restore(
    payload: ConfigBackupPayload,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
) -> ConfigRestoreSummary:
    """Restore device customizations, groups, and schedules from a backup snapshot."""
    try:
        return await restore_configuration_backup(db, payload, actor=current_user.username)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
