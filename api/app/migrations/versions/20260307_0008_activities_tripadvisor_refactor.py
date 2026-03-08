"""Expand event snapshots for TripAdvisor-backed activities.

Revision ID: 20260307_0008
Revises: 20260306_0008, 20260307_0007
Create Date: 2026-03-07 13:40:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260307_0008"
down_revision: Union[str, Sequence[str], None] = ("20260306_0008", "20260307_0007")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("event_snapshot", sa.Column("entity_type", sa.String(length=32), nullable=True))
    op.add_column("event_snapshot", sa.Column("rating", sa.Numeric(precision=4, scale=2), nullable=True))
    op.add_column("event_snapshot", sa.Column("review_count", sa.Integer(), nullable=True))
    op.add_column("event_snapshot", sa.Column("price_label", sa.String(length=128), nullable=True))
    op.add_column(
        "event_snapshot",
        sa.Column(
            "tags_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column("event_snapshot", sa.Column("status_text", sa.String(length=255), nullable=True))
    op.add_column(
        "event_snapshot",
        sa.Column(
            "provider_detail_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.create_index(op.f("ix_event_snapshot_entity_type"), "event_snapshot", ["entity_type"], unique=False)
    op.alter_column("event_snapshot", "tags_json", server_default=None)
    op.alter_column("event_snapshot", "provider_detail_json", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f("ix_event_snapshot_entity_type"), table_name="event_snapshot")
    op.drop_column("event_snapshot", "provider_detail_json")
    op.drop_column("event_snapshot", "status_text")
    op.drop_column("event_snapshot", "tags_json")
    op.drop_column("event_snapshot", "price_label")
    op.drop_column("event_snapshot", "review_count")
    op.drop_column("event_snapshot", "rating")
    op.drop_column("event_snapshot", "entity_type")
