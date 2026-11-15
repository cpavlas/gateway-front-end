"""Phase 18 custom domain/ASN blocked_targets and device_groups daily YouTube quota schema.

Revision ID: 0009_phase18_domain_asn_blocks_and_group_quotas
Revises: 0008_phase17_archive_and_schedule_modes
Create Date: 2026-11-15
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0009_phase18_domain_asn_blocks_and_group_quotas"
down_revision = "0008_phase17_archive_and_schedule_modes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "device_groups" in existing_tables:
        group_cols = {c["name"] for c in inspector.get_columns("device_groups")}
        if "daily_youtube_limit_minutes" not in group_cols:
            op.add_column(
                "device_groups",
                sa.Column(
                    "daily_youtube_limit_minutes",
                    sa.Integer(),
                    nullable=True,
                ),
            )

    if "blocked_targets" not in existing_tables:
        op.create_table(
            "blocked_targets",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("target_type", sa.String(length=16), nullable=False),
            sa.Column("target_value", sa.String(length=255), nullable=False),
            sa.Column(
                "scope_type",
                sa.String(length=16),
                nullable=False,
                server_default="global",
            ),
            sa.Column(
                "device_id",
                sa.Integer(),
                sa.ForeignKey("devices.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column(
                "organization_name",
                sa.String(length=255),
                nullable=False,
                server_default="",
            ),
            sa.Column("reason", sa.Text(), nullable=False, server_default=""),
            sa.Column(
                "is_enabled",
                sa.Boolean(),
                nullable=False,
                server_default="1",
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.UniqueConstraint(
                "target_type",
                "target_value",
                "scope_type",
                "device_id",
                name="uq_blocked_targets_scope_target",
            ),
        )
        op.create_index("ix_blocked_targets_target_type", "blocked_targets", ["target_type"])
        op.create_index("ix_blocked_targets_target_value", "blocked_targets", ["target_value"])
        op.create_index("ix_blocked_targets_scope_type", "blocked_targets", ["scope_type"])
        op.create_index("ix_blocked_targets_device_id", "blocked_targets", ["device_id"])
        op.create_index("ix_blocked_targets_is_enabled", "blocked_targets", ["is_enabled"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "blocked_targets" in existing_tables:
        op.drop_index("ix_blocked_targets_is_enabled", table_name="blocked_targets")
        op.drop_index("ix_blocked_targets_device_id", table_name="blocked_targets")
        op.drop_index("ix_blocked_targets_scope_type", table_name="blocked_targets")
        op.drop_index("ix_blocked_targets_target_value", table_name="blocked_targets")
        op.drop_index("ix_blocked_targets_target_type", table_name="blocked_targets")
        op.drop_table("blocked_targets")

    if "device_groups" in existing_tables:
        group_cols = {c["name"] for c in inspector.get_columns("device_groups")}
        if "daily_youtube_limit_minutes" in group_cols:
            op.drop_column("device_groups", "daily_youtube_limit_minutes")
