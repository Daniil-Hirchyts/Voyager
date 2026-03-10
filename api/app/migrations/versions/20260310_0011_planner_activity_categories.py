"""Add planner activity categories and offer linkage.

Revision ID: 20260310_0011
Revises: 20260310_0010
Create Date: 2026-03-10 13:40:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260310_0011"
down_revision: Union[str, Sequence[str], None] = "20260310_0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


activity_category_enum = sa.Enum(
    "visit",
    "eat",
    "activity",
    "hotel",
    "travel",
    name="activity_category_enum",
    native_enum=False,
)


def upgrade() -> None:
    activity_category_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "activity",
        sa.Column("category", activity_category_enum, nullable=True, server_default="visit"),
    )
    op.add_column(
        "activity",
        sa.Column(
            "category_details_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column("activity", sa.Column("linked_offer_kind", sa.String(length=16), nullable=True))
    op.add_column(
        "activity",
        sa.Column("linked_offer_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "ix_activity_linked_offer_unique",
        "activity",
        ["linked_offer_kind", "linked_offer_id"],
        unique=True,
        postgresql_where=sa.text("linked_offer_id IS NOT NULL"),
    )

    op.execute(
        """
        UPDATE activity AS a
        SET category = 'eat'
        FROM event_snapshot AS es
        WHERE a.event_snapshot_id = es.id
          AND es.entity_type = 'restaurant'
        """
    )
    op.execute(
        """
        UPDATE activity AS a
        SET category = 'activity'
        FROM place AS p
        WHERE a.place_id = p.id
          AND a.category = 'visit'
          AND lower(coalesce(p.category, '')) SIMILAR TO '%(tour|experience|event|activity)%'
        """
    )
    op.execute(
        """
        UPDATE activity AS a
        SET category = 'eat'
        FROM place AS p
        WHERE a.place_id = p.id
          AND a.category = 'visit'
          AND lower(coalesce(p.category, '')) SIMILAR TO '%(restaurant|cafe|food|bar)%'
        """
    )
    op.execute(
        """
        UPDATE activity
        SET category = CASE
            WHEN lower(coalesce(title, '')) SIMILAR TO '%(breakfast|lunch|dinner|restaurant|cafe|bistro)%' THEN 'eat'
            WHEN lower(coalesce(title, '')) SIMILAR TO '%(tour|cruise|show|workshop|experience)%' THEN 'activity'
            ELSE category
        END
        """
    )
    op.execute("UPDATE activity SET category = 'visit' WHERE category IS NULL")

    op.alter_column("activity", "category", nullable=False, server_default=None)
    op.alter_column("activity", "category_details_json", server_default=None)
    op.drop_column("activity", "tags_json")


def downgrade() -> None:
    op.add_column(
        "activity",
        sa.Column(
            "tags_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.execute(
        """
        UPDATE activity
        SET tags_json = CASE category
            WHEN 'eat' THEN '["eat"]'::jsonb
            WHEN 'activity' THEN '["activity"]'::jsonb
            WHEN 'hotel' THEN '["hotel"]'::jsonb
            WHEN 'travel' THEN '["travel"]'::jsonb
            ELSE '["visit"]'::jsonb
        END
        """
    )
    op.alter_column("activity", "tags_json", server_default=None)
    op.drop_index("ix_activity_linked_offer_unique", table_name="activity")
    op.drop_column("activity", "linked_offer_id")
    op.drop_column("activity", "linked_offer_kind")
    op.drop_column("activity", "category_details_json")
    op.drop_column("activity", "category")
    activity_category_enum.drop(op.get_bind(), checkfirst=True)
