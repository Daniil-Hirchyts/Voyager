"""Add persisted trip map layers.

Revision ID: 20260307_0009
Revises: 20260307_0008
Create Date: 2026-03-07 17:45:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260307_0009"
down_revision: Union[str, Sequence[str], None] = "20260307_0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "trip_map_layer",
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("renderer", sa.String(length=32), nullable=False),
        sa.Column(
            "feature_collection_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "style_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "metadata_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("is_visible", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trip.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_trip_map_layer")),
    )
    op.create_index(op.f("ix_trip_map_layer_trip_id"), "trip_map_layer", ["trip_id"], unique=False)
    op.create_index(op.f("ix_trip_map_layer_source"), "trip_map_layer", ["source"], unique=False)
    op.create_index(
        "ix_trip_map_layer_trip_order",
        "trip_map_layer",
        ["trip_id", "order_index"],
        unique=False,
    )
    op.alter_column("trip_map_layer", "feature_collection_json", server_default=None)
    op.alter_column("trip_map_layer", "style_json", server_default=None)
    op.alter_column("trip_map_layer", "metadata_json", server_default=None)
    op.alter_column("trip_map_layer", "is_visible", server_default=None)
    op.alter_column("trip_map_layer", "is_locked", server_default=None)
    op.alter_column("trip_map_layer", "order_index", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_trip_map_layer_trip_order", table_name="trip_map_layer")
    op.drop_index(op.f("ix_trip_map_layer_source"), table_name="trip_map_layer")
    op.drop_index(op.f("ix_trip_map_layer_trip_id"), table_name="trip_map_layer")
    op.drop_table("trip_map_layer")
