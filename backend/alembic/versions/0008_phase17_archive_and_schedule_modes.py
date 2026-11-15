"""Phase 17 devices.is_archived and schedules.block_mode / snoozed_until schema.

Revision ID: 0008_phase17_archive_and_schedule_modes
Revises: 0007_phase9_users_settings_audit_labels
Create Date: 2026-11-14
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0008_phase17_archive_and_schedule_modes"
down_revision = "0007_phase9_users_settings_audit_labels"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "devices" in existing_tables:
        device_cols = {c["name"] for c in inspector.get_columns("devices")}
        if "is_archived" not in device_cols:
            op.add_column(
                "devices",
                sa.Column(
                    "is_archived",
                    sa.Boolean(),
                    nullable=False,
                    server_default="0",
                ),
            )
            op.create_index("ix_devices_is_archived", "devices", ["is_archived"])

    if "schedules" in existing_tables:
        sched_cols = {c["name"] for c in inspector.get_columns("schedules")}
        if "block_mode" not in sched_cols:
            op.add_column(
                "schedules",
                sa.Column(
                    "block_mode",
                    sa.String(length=16),
                    nullable=False,
                    server_default="internet",
                ),
            )
            op.create_index("ix_schedules_block_mode", "schedules", ["block_mode"])
        if "snoozed_until" not in sched_cols:
            op.add_column(
                "schedules",
                sa.Column(
                    "snoozed_until",
                    sa.DateTime(timezone=True),
                    nullable=True,
                ),
            )
            op.create_index("ix_schedules_snoozed_until", "schedules", ["snoozed_until"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "schedules" in existing_tables:
        sched_cols = {c["name"] for c in inspector.get_columns("schedules")}
        if "snoozed_until" in sched_cols:
            op.drop_index("ix_schedules_snoozed_until", table_name="schedules")
            op.drop_column("schedules", "snoozed_until")
        if "block_mode" in sched_cols:
            op.drop_index("ix_schedules_block_mode", table_name="schedules")
            op.drop_column("schedules", "block_mode")

    if "devices" in existing_tables:
        device_cols = {c["name"] for c in inspector.get_columns("devices")}
        if "is_archived" in device_cols:
            op.drop_index("ix_devices_is_archived", table_name="devices")
            op.drop_column("devices", "is_archived")
