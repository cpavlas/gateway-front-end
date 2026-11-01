"""FastAPI application entrypoint and SPA static serving."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api.analytics import router as analytics_router
from app.api.auth import router as auth_router
from app.api.devices import router as devices_router
from app.api.groups import router as groups_router
from app.api.system import router as system_router
from app.db import dispose_db, init_db

DEFAULT_FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Initialize SQLite schema on startup and dispose engine on shutdown."""
    await init_db()
    yield
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

    app.include_router(auth_router)
    app.include_router(system_router)
    app.include_router(devices_router)
    app.include_router(groups_router)
    app.include_router(analytics_router)

    dist_path = frontend_dist_dir if frontend_dist_dir is not None else DEFAULT_FRONTEND_DIST
    configure_spa_serving(app, dist_path)

    return app


app = create_app()
