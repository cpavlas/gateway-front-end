"""Phase 7 selective YouTube blocking column on devices table.

Revision ID: 0006_phase7_youtube_block
Revises: 0005_phase6_schedules
Create Date: 2026-11-01
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0006_phase7_youtube_block"
down_revision = "0005_phase6_schedules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "devices",
        sa.Column("is_youtube_blocked", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.create_index("ix_devices_is_youtube_blocked", "devices", ["is_youtube_blocked"])


def downgrade() -> None:
    op.drop_index("ix_devices_is_youtube_blocked", table_name="devices")
    op.drop_column("devices", "is_youtube_blocked")

