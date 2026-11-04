"""Phase 9 users, system_settings, and audit_logs.audit_label schema.

Revision ID: 0007_phase9_users_settings_audit_labels
Revises: 0006_phase7_youtube_block
Create Date: 2026-11-03
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0007_phase9_users_settings_audit_labels"
down_revision = "0006_phase7_youtube_block"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "audit_logs" in existing_tables:
        audit_cols = {c["name"] for c in inspector.get_columns("audit_logs")}
        if "audit_label" not in audit_cols:
            op.add_column(
                "audit_logs",
                sa.Column(
                    "audit_label",
                    sa.String(length=32),
                    nullable=False,
                    server_default="SYSTEM",
                ),
            )
            op.create_index("ix_audit_logs_audit_label", "audit_logs", ["audit_label"])

    if "users" not in existing_tables:
        op.create_table(
            "users",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("username", sa.String(length=64), nullable=False, unique=True),
            sa.Column("password_hash", sa.String(length=255), nullable=False),
            sa.Column(
                "role",
                sa.String(length=32),
                nullable=False,
                server_default="operator",
            ),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
            sa.Column(
                "theme_preference",
                sa.String(length=32),
                nullable=False,
                server_default="default",
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_users_username", "users", ["username"], unique=True)
        op.create_index("ix_users_role", "users", ["role"])
        op.create_index("ix_users_is_active", "users", ["is_active"])

    if "system_settings" not in existing_tables:
        op.create_table(
            "system_settings",
            sa.Column("key", sa.String(length=128), primary_key=True),
            sa.Column("value_text", sa.Text(), nullable=False, server_default=""),
            sa.Column("is_secret", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column(
                "updated_by",
                sa.String(length=64),
                nullable=False,
                server_default="admin",
            ),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )


def downgrade() -> None:
    op.drop_table("system_settings")
    op.drop_index("ix_users_is_active", table_name="users")
    op.drop_index("ix_users_role", table_name="users")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
    op.drop_index("ix_audit_logs_audit_label", table_name="audit_logs")
    op.drop_column("audit_logs", "audit_label")

