"""Add planner assistant thread and message tables.

Revision ID: 20260313_0020
Revises: 20260313_0019
Create Date: 2026-03-13 18:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260313_0020"
down_revision: Union[str, Sequence[str], None] = "20260313_0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "assistant_thread",
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["trip_id"],
            ["trip.id"],
            name=op.f("fk_assistant_thread_trip_id_trip"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user_profile.id"],
            name=op.f("fk_assistant_thread_user_id_user_profile"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_assistant_thread")),
        sa.UniqueConstraint("trip_id", "user_id", name="uq_assistant_thread_trip_user"),
    )
    op.create_index(
        op.f("ix_assistant_thread_trip_id"),
        "assistant_thread",
        ["trip_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_assistant_thread_user_id"),
        "assistant_thread",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_assistant_thread_trip_created",
        "assistant_thread",
        ["trip_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "assistant_message",
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("parts_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("source_job_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["source_job_id"],
            ["job.id"],
            name=op.f("fk_assistant_message_source_job_id_job"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["thread_id"],
            ["assistant_thread.id"],
            name=op.f("fk_assistant_message_thread_id_assistant_thread"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_assistant_message")),
        sa.UniqueConstraint("source_job_id", name="uq_assistant_message_source_job_id"),
    )
    op.create_index(
        op.f("ix_assistant_message_thread_id"),
        "assistant_message",
        ["thread_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_assistant_message_source_job_id"),
        "assistant_message",
        ["source_job_id"],
        unique=False,
    )
    op.create_index(
        "ix_assistant_message_thread_created",
        "assistant_message",
        ["thread_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_assistant_message_thread_created", table_name="assistant_message")
    op.drop_index(op.f("ix_assistant_message_source_job_id"), table_name="assistant_message")
    op.drop_index(op.f("ix_assistant_message_thread_id"), table_name="assistant_message")
    op.drop_table("assistant_message")

    op.drop_index("ix_assistant_thread_trip_created", table_name="assistant_thread")
    op.drop_index(op.f("ix_assistant_thread_user_id"), table_name="assistant_thread")
    op.drop_index(op.f("ix_assistant_thread_trip_id"), table_name="assistant_thread")
    op.drop_table("assistant_thread")

