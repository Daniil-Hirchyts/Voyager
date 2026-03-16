"""Add trip-scoped planner inbox activities.

Revision ID: 20260310_0010
Revises: 20260307_0009
Create Date: 2026-03-10 10:30:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260310_0010"
down_revision: Union[str, Sequence[str], None] = "20260307_0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("activity", sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index(op.f("ix_activity_trip_id"), "activity", ["trip_id"], unique=False)
    op.create_foreign_key(
        op.f("fk_activity_trip_id_trip"),
        "activity",
        "trip",
        ["trip_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.execute(
        """
        UPDATE activity AS a
        SET trip_id = td.trip_id
        FROM trip_day AS td
        WHERE a.trip_day_id = td.id
        """
    )
    op.alter_column("activity", "trip_id", nullable=False)
    op.drop_constraint("uq_activity_trip_day_order", "activity", type_="unique")
    op.alter_column("activity", "trip_day_id", nullable=True)
    op.create_index(
        "ix_activity_trip_day_order_assigned",
        "activity",
        ["trip_day_id", "order_index"],
        unique=True,
        postgresql_where=sa.text("trip_day_id IS NOT NULL"),
    )
    op.create_index(
        "ix_activity_trip_order_inbox",
        "activity",
        ["trip_id", "order_index"],
        unique=True,
        postgresql_where=sa.text("trip_day_id IS NULL"),
    )


def downgrade() -> None:
    op.execute(
        """
        WITH first_days AS (
            SELECT DISTINCT ON (trip_id)
                trip_id,
                id AS day_id
            FROM trip_day
            ORDER BY trip_id, day_index
        ),
        day_offsets AS (
            SELECT
                fd.trip_id,
                fd.day_id,
                COALESCE(MAX(a.order_index), -1) AS max_order
            FROM first_days AS fd
            LEFT JOIN activity AS a
                ON a.trip_day_id = fd.day_id
            GROUP BY fd.trip_id, fd.day_id
        ),
        reassigned AS (
            SELECT
                a.id,
                fd.day_id,
                day_offsets.max_order
                    + ROW_NUMBER() OVER (
                        PARTITION BY a.trip_id
                        ORDER BY a.order_index, a.created_at, a.id
                    ) AS new_order
            FROM activity AS a
            JOIN first_days AS fd
                ON fd.trip_id = a.trip_id
            JOIN day_offsets
                ON day_offsets.trip_id = a.trip_id
            WHERE a.trip_day_id IS NULL
        )
        UPDATE activity AS a
        SET trip_day_id = reassigned.day_id,
            order_index = reassigned.new_order
        FROM reassigned
        WHERE a.id = reassigned.id
        """
    )
    op.drop_index("ix_activity_trip_order_inbox", table_name="activity")
    op.drop_index("ix_activity_trip_day_order_assigned", table_name="activity")
    op.alter_column("activity", "trip_day_id", nullable=False)
    op.create_unique_constraint(
        "uq_activity_trip_day_order", "activity", ["trip_day_id", "order_index"]
    )
    op.drop_constraint(op.f("fk_activity_trip_id_trip"), "activity", type_="foreignkey")
    op.drop_index(op.f("ix_activity_trip_id"), table_name="activity")
    op.drop_column("activity", "trip_id")
