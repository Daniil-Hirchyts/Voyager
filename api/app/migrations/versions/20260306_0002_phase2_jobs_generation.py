"""phase2 async itinerary jobs and generation metadata

Revision ID: 20260306_0002
Revises: 20260305_0001
Create Date: 2026-03-06 10:15:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260306_0002"
down_revision: Union[str, None] = "20260305_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("trip", sa.Column("last_generated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "trip",
        sa.Column(
            "generation_state",
            sa.String(length=32),
            nullable=False,
            server_default="NEVER",
        ),
    )

    op.add_column(
        "activity", sa.Column("generation_batch_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_index(
        op.f("ix_activity_generation_batch_id"),
        "activity",
        ["generation_batch_id"],
        unique=False,
    )

    op.add_column(
        "job",
        sa.Column("attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "job",
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default=sa.text("3")),
    )
    op.add_column(
        "job",
        sa.Column(
            "available_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.add_column("job", sa.Column("dead_lettered_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_job_status_available_at", "job", ["status", "available_at"], unique=False)

    op.alter_column("trip", "generation_state", server_default=None)
    op.alter_column("job", "attempts", server_default=None)
    op.alter_column("job", "max_attempts", server_default=None)
    op.alter_column("job", "available_at", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_job_status_available_at", table_name="job")
    op.drop_column("job", "dead_lettered_at")
    op.drop_column("job", "available_at")
    op.drop_column("job", "max_attempts")
    op.drop_column("job", "attempts")

    op.drop_index(op.f("ix_activity_generation_batch_id"), table_name="activity")
    op.drop_column("activity", "generation_batch_id")

    op.drop_column("trip", "generation_state")
    op.drop_column("trip", "last_generated_at")
