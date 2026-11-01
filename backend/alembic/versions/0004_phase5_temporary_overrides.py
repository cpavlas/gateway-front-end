"""Create temporary_overrides table for Phase 5 timed controls.

Revision ID: 0004_phase5_temporary_overrides
Revises: 0003_phase4_device_groups
Create Date: 2026-10-31 21:30:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0004_phase5_temporary_overrides"
down_revision: str | None = "0003_phase4_device_groups"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    """Create temporary_overrides table and indexes."""
    op.create_table(
        "temporary_overrides",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("target_type", sa.String(length=16), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=True),
        sa.Column("group_id", sa.Integer(), nullable=True),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False, server_default="admin"),
        sa.Column("reason", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["device_groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_temporary_overrides_target_type",
        "temporary_overrides",
        ["target_type"],
        unique=False,
    )
    op.create_index(
        "ix_temporary_overrides_device_id",
        "temporary_overrides",
        ["device_id"],
        unique=False,
    )
    op.create_index(
        "ix_temporary_overrides_group_id",
        "temporary_overrides",
        ["group_id"],
        unique=False,
    )
    op.create_index(
        "ix_temporary_overrides_mode",
        "temporary_overrides",
        ["mode"],
        unique=False,
    )
    op.create_index(
        "ix_temporary_overrides_is_active",
        "temporary_overrides",
        ["is_active"],
        unique=False,
    )
    op.create_index(
        "ix_temporary_overrides_expires_at",
        "temporary_overrides",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    """Drop temporary_overrides table."""
    op.drop_index("ix_temporary_overrides_expires_at", table_name="temporary_overrides")
    op.drop_index("ix_temporary_overrides_is_active", table_name="temporary_overrides")
    op.drop_index("ix_temporary_overrides_mode", table_name="temporary_overrides")
    op.drop_index("ix_temporary_overrides_group_id", table_name="temporary_overrides")
    op.drop_index("ix_temporary_overrides_device_id", table_name="temporary_overrides")
    op.drop_index("ix_temporary_overrides_target_type", table_name="temporary_overrides")
    op.drop_table("temporary_overrides")

