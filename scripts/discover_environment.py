"""CLI entrypoint to run Step 1.4 read-only OPNsense & Elasticsearch discovery."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import get_settings
from app.services.discovery_probe import run_full_discovery


async def _main() -> int:
    settings = get_settings()
    output_md = REPO_ROOT / "docs" / "ES_SCHEMA_DISCOVERY.md"
    print(
        f"[Discovery] Probing OPNsense ({settings.opnsense_base_url}) and ES ({settings.elasticsearch_url})..."
    )
    opn_data, es_data = await run_full_discovery(settings, output_md)

    opn_status = opn_data["health"]["status"]
    es_status = es_data["health"]["status"]
    print(
        f"[Discovery] OPNsense status:      {opn_status.upper()} - {opn_data['health']['message']}"
    )
    print(
        f"[Discovery] Elasticsearch status: {es_status.upper()} - {es_data['health']['message']}"
    )
    print(f"[Discovery] Report written to:    {output_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
