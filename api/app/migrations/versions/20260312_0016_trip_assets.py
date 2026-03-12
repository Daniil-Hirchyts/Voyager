"""Add trip asset storage table.

Revision ID: 20260312_0016
Revises: 20260311_0015
Create Date: 2026-03-12 09:50:00.000000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260312_0016"
down_revision = "20260311_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "trip_asset",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("thumbnail_object_key", sa.Text(), nullable=True),
        sa.Column("image_width", sa.Integer(), nullable=True),
        sa.Column("image_height", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.CheckConstraint("kind IN ('photo', 'file')", name=op.f("ck_trip_asset_trip_asset_kind")),
        sa.ForeignKeyConstraint(
            ["activity_id"],
            ["activity.id"],
            name=op.f("fk_trip_asset_activity_id_activity"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["trip_id"],
            ["trip.id"],
            name=op.f("fk_trip_asset_trip_id_trip"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user_profile.id"],
            name=op.f("fk_trip_asset_user_id_user_profile"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_trip_asset")),
        sa.UniqueConstraint("object_key", name=op.f("uq_trip_asset_object_key")),
        sa.UniqueConstraint(
            "thumbnail_object_key",
            name=op.f("uq_trip_asset_thumbnail_object_key"),
        ),
    )
    op.create_index(op.f("ix_trip_asset_activity_id"), "trip_asset", ["activity_id"], unique=False)
    op.create_index(op.f("ix_trip_asset_kind"), "trip_asset", ["kind"], unique=False)
    op.create_index(
        "ix_trip_asset_trip_activity_created",
        "trip_asset",
        ["trip_id", "activity_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_trip_asset_user_created",
        "trip_asset",
        ["user_id", "created_at"],
        unique=False,
    )
    op.create_index(op.f("ix_trip_asset_trip_id"), "trip_asset", ["trip_id"], unique=False)
    op.create_index(op.f("ix_trip_asset_user_id"), "trip_asset", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_trip_asset_user_id"), table_name="trip_asset")
    op.drop_index(op.f("ix_trip_asset_trip_id"), table_name="trip_asset")
    op.drop_index("ix_trip_asset_user_created", table_name="trip_asset")
    op.drop_index("ix_trip_asset_trip_activity_created", table_name="trip_asset")
    op.drop_index(op.f("ix_trip_asset_kind"), table_name="trip_asset")
    op.drop_index(op.f("ix_trip_asset_activity_id"), table_name="trip_asset")
    op.drop_table("trip_asset")
