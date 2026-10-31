"""Create devices inventory table for Phase 2.

Revision ID: 0002_devices_inventory
Revises: 0001_initial_foundation
Create Date: 2026-10-31 15:02:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0002_devices_inventory"
down_revision: str | None = "0001_initial_foundation"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    """Create devices table and indexes."""
    op.create_table(
        "devices",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("mac_address", sa.String(length=17), nullable=False),
        sa.Column("ipv4_address", sa.String(length=45), nullable=True),
        sa.Column("hostname", sa.String(length=255), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("vendor", sa.String(length=255), nullable=True),
        sa.Column("interface_name", sa.String(length=64), nullable=True),
        sa.Column("lease_type", sa.String(length=32), nullable=False, server_default="unknown"),
        sa.Column("is_online", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_blocked", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_protected", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mac_address", name="uq_devices_mac_address"),
    )
    op.create_index("ix_devices_mac_address", "devices", ["mac_address"], unique=True)
    op.create_index("ix_devices_ipv4_address", "devices", ["ipv4_address"], unique=False)
    op.create_index("ix_devices_is_online", "devices", ["is_online"], unique=False)
    op.create_index("ix_devices_is_blocked", "devices", ["is_blocked"], unique=False)
    op.create_index("ix_devices_is_protected", "devices", ["is_protected"], unique=False)


def downgrade() -> None:
    """Drop devices table and indexes."""
    op.drop_index("ix_devices_is_protected", table_name="devices")
    op.drop_index("ix_devices_is_blocked", table_name="devices")
    op.drop_index("ix_devices_is_online", table_name="devices")
    op.drop_index("ix_devices_ipv4_address", table_name="devices")
    op.drop_index("ix_devices_mac_address", table_name="devices")
    op.drop_table("devices")
