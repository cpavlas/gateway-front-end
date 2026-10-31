"""Unit tests for FastAPI SPA static serving and fallback routing."""

from __future__ import annotations

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app


@pytest.mark.asyncio
async def test_spa_serving_index_assets_and_api_404(tmp_path: Path) -> None:
    """Verify SPA index fallback, static file serving, and /api/* 404 preservation."""
    dist_dir = tmp_path / "dist"
    assets_dir = dist_dir / "assets"
    assets_dir.mkdir(parents=True)

    index_html = dist_dir / "index.html"
    index_html.write_text("<!doctype html><title>SPA Test</title>", encoding="utf-8")

    robots_txt = dist_dir / "robots.txt"
    robots_txt.write_text("User-agent: *", encoding="utf-8")

    js_bundle = assets_dir / "app.js"
    js_bundle.write_text("console.log('ready');", encoding="utf-8")

    app = create_app(frontend_dist_dir=dist_dir)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Root path returns index.html
        root_resp = await client.get("/")
        assert root_resp.status_code == 200
        assert "<title>SPA Test</title>" in root_resp.text

        # 2. Client-side route falls back to index.html
        route_resp = await client.get("/devices/overview")
        assert route_resp.status_code == 200
        assert "<title>SPA Test</title>" in route_resp.text

        # 3. Direct static file in dist root is served directly
        robots_resp = await client.get("/robots.txt")
        assert robots_resp.status_code == 200
        assert "User-agent: *" in robots_resp.text

        # 4. Mounted /assets bundle is served
        asset_resp = await client.get("/assets/app.js")
        assert asset_resp.status_code == 200
        assert "console.log('ready');" in asset_resp.text

        # 5. Unknown /api/* route returns 404 JSON instead of SPA index.html
        api_404 = await client.get("/api/v1/unknown-route")
        assert api_404.status_code == 404
        assert api_404.json()["detail"] == "API endpoint not found."


@pytest.mark.asyncio
async def test_create_app_without_dist_dir_skips_spa_mount(tmp_path: Path) -> None:
    """Verify create_app works cleanly when frontend/dist has not been built yet."""
    missing_dist = tmp_path / "nonexistent_dist"
    app = create_app(frontend_dist_dir=missing_dist)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        ping_resp = await client.get("/api/v1/system/ping")
        assert ping_resp.status_code == 200
        root_resp = await client.get("/")
        assert root_resp.status_code == 404
