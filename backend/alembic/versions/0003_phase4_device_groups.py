"""Create device_groups and device_group_memberships tables for Phase 4.

Revision ID: 0003_phase4_device_groups
Revises: 0002_devices_inventory
Create Date: 2026-10-31 17:30:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0003_phase4_device_groups"
down_revision: str | None = "0002_devices_inventory"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    """Create device_groups and device_group_memberships tables and indexes."""
    op.create_table(
        "device_groups",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("color_badge", sa.String(length=32), nullable=False, server_default="indigo"),
        sa.Column("icon", sa.String(length=32), nullable=False, server_default="users"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_device_groups_name"),
    )
    op.create_index("ix_device_groups_name", "device_groups", ["name"], unique=True)

    op.create_table(
        "device_group_memberships",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["device_groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("group_id", "device_id", name="uq_device_group_membership"),
    )
    op.create_index(
        "ix_device_group_memberships_group_id",
        "device_group_memberships",
        ["group_id"],
        unique=False,
    )
    op.create_index(
        "ix_device_group_memberships_device_id",
        "device_group_memberships",
        ["device_id"],
        unique=False,
    )


def downgrade() -> None:
    """Drop device_group_memberships and device_groups tables."""
    op.drop_index(
        "ix_device_group_memberships_device_id",
        table_name="device_group_memberships",
    )
    op.drop_index(
        "ix_device_group_memberships_group_id",
        table_name="device_group_memberships",
    )
    op.drop_table("device_group_memberships")
    op.drop_index("ix_device_groups_name", table_name="device_groups")
    op.drop_table("device_groups")

