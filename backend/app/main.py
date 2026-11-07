"""FastAPI application entrypoint, SPA static serving, and background timer scheduler."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore[import-untyped]
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api.analytics import router as analytics_router
from app.api.auth import router as auth_router
from app.api.devices import router as devices_router
from app.api.firewall import router as firewall_router
from app.api.groups import router as groups_router
from app.api.schedules import router as schedules_router
from app.api.system import audit_router
from app.api.system import router as system_router
from app.api.timers import router as timers_router
from app.api.users import router as users_router
from app.clients.elasticsearch import ElasticsearchServiceClient
from app.clients.opnsense import OPNsenseClient
from app.config import apply_runtime_overrides, get_settings
from app.db import dispose_db, get_session_factory, init_db
from app.services.analytics_service import get_network_overview_analytics
from app.services.firewall_service import get_firewall_overview_analytics
from app.services.runtime_settings_service import load_runtime_settings_from_db
from app.services.schedule_service import reconcile_schedules_and_policies
from app.services.timer_service import reconcile_expired_overrides

DEFAULT_FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


async def run_scheduled_override_reconciliation() -> None:
    """Background task tick: reconcile any expired temporary overrides with OPNsense."""
    base_settings = get_settings()
    session_factory = get_session_factory(base_settings)
    async with session_factory() as session:
        await load_runtime_settings_from_db(session, base_settings)
        effective_settings = apply_runtime_overrides(base_settings)
        opnsense = OPNsenseClient(effective_settings)
        await reconcile_expired_overrides(session, opnsense, effective_settings)
        await reconcile_schedules_and_policies(session, opnsense, effective_settings)


async def run_telemetry_cache_prewarm(*, force: bool = False) -> bool:
    """Background task tick: pre-warm default 24h NetworkOverview and FirewallOverview caches."""
    base_settings = get_settings()
    session_factory = get_session_factory(base_settings)
    async with session_factory() as session:
        await load_runtime_settings_from_db(session, base_settings)
        effective_settings = apply_runtime_overrides(base_settings)
        es_key = effective_settings.elasticsearch_api_key.get_secret_value().strip()
        if not force and (
            effective_settings.app_env == "testing" or es_key in ("", "changeme")
        ):
            return False
        es_client = ElasticsearchServiceClient(effective_settings)
        await get_network_overview_analytics(
            db=session,
            settings=effective_settings,
            es_client=es_client,
            window="24h",
            refresh=True,
        )
        await get_firewall_overview_analytics(
            db=session,
            settings=effective_settings,
            es_client=es_client,
            window="24h",
            refresh=True,
        )
        return True


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Initialize SQLite schema, reconcile expired overrides on boot, and run 60s APScheduler."""
    await init_db()
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        run_scheduled_override_reconciliation,
        "interval",
        seconds=60,
        id="reconcile_expired_overrides",
        replace_existing=True,
    )
    scheduler.add_job(
        run_telemetry_cache_prewarm,
        "interval",
        seconds=60,
        id="prewarm_default_telemetry_caches",
        replace_existing=True,
    )
    scheduler.start()
    try:
        await run_scheduled_override_reconciliation()
    except Exception:
        pass
    prewarm_task = asyncio.create_task(run_telemetry_cache_prewarm())
    try:
        yield
    finally:
        prewarm_task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await prewarm_task
        scheduler.shutdown(wait=False)
        await dispose_db()


def configure_spa_serving(app: FastAPI, dist_dir: Path) -> None:
    """Mount compiled Vite assets and configure SPA index.html fallback routing."""
    resolved_dist = dist_dir.resolve()
    index_file = resolved_dist / "index.html"
    if not index_file.is_file():
        return

    assets_dir = resolved_dist / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="spa-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str) -> FileResponse:
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found.")

        if full_path:
            candidate = (resolved_dist / full_path).resolve()
            if candidate.is_relative_to(resolved_dist) and candidate.is_file():
                return FileResponse(candidate)

        return FileResponse(index_file)


def create_app(frontend_dist_dir: Path | None = None) -> FastAPI:
    """Create and configure the FastAPI application instance."""
    app = FastAPI(
        title="Gateway Network Access Controller",
        version=__version__,
        lifespan=lifespan,
    )

    @app.middleware("http")
    async def add_security_headers(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        return response

    app.include_router(auth_router)
    app.include_router(users_router)
    app.include_router(system_router)
    app.include_router(audit_router)
    app.include_router(devices_router)
    app.include_router(groups_router)
    app.include_router(timers_router)
    app.include_router(schedules_router)
    app.include_router(analytics_router)
    app.include_router(firewall_router)

    dist_path = frontend_dist_dir if frontend_dist_dir is not None else DEFAULT_FRONTEND_DIST
    configure_spa_serving(app, dist_path)

    return app


app = create_app()
