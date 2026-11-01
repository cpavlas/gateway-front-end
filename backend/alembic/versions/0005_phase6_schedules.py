"""Phase 6 recurring schedules table and device is_manually_blocked column.

Revision ID: 0005_phase6_schedules
Revises: 0004_phase5_temporary_overrides
Create Date: 2026-11-01
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0005_phase6_schedules"
down_revision = "0004_phase5_temporary_overrides"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "devices",
        sa.Column("is_manually_blocked", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.create_index("ix_devices_is_manually_blocked", "devices", ["is_manually_blocked"])

    op.create_table(
        "schedules",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("target_type", sa.String(length=16), nullable=False),
        sa.Column(
            "device_id",
            sa.Integer(),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "group_id",
            sa.Integer(),
            sa.ForeignKey("device_groups.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("days_of_week", sa.String(length=32), nullable=False),
        sa.Column("start_time", sa.String(length=8), nullable=False),
        sa.Column("end_time", sa.String(length=8), nullable=False),
        sa.Column(
            "timezone",
            sa.String(length=64),
            nullable=False,
            server_default="America/Los_Angeles",
        ),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_schedules_name", "schedules", ["name"])
    op.create_index("ix_schedules_target_type", "schedules", ["target_type"])
    op.create_index("ix_schedules_device_id", "schedules", ["device_id"])
    op.create_index("ix_schedules_group_id", "schedules", ["group_id"])
    op.create_index("ix_schedules_is_enabled", "schedules", ["is_enabled"])


def downgrade() -> None:
    op.drop_index("ix_schedules_is_enabled", table_name="schedules")
    op.drop_index("ix_schedules_group_id", table_name="schedules")
    op.drop_index("ix_schedules_device_id", table_name="schedules")
    op.drop_index("ix_schedules_target_type", table_name="schedules")
    op.drop_index("ix_schedules_name", table_name="schedules")
    op.drop_table("schedules")
    op.drop_index("ix_devices_is_manually_blocked", table_name="devices")
    op.drop_column("devices", "is_manually_blocked")
