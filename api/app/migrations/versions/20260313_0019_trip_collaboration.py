"""Add trip collaboration tables.

Revision ID: 20260313_0019
Revises: 20260313_0018
Create Date: 2026-03-13 14:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260313_0019"
down_revision: Union[str, Sequence[str], None] = "20260313_0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    trip_access_role_enum = sa.Enum(
        "owner",
        "editor",
        name="trip_access_role_enum",
        native_enum=False,
    )

    op.create_table(
        "trip_collaborator",
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", trip_access_role_enum, nullable=False),
        sa.Column("invited_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["invited_by_user_id"],
            ["user_profile.id"],
            name=op.f("fk_trip_collaborator_invited_by_user_id_user_profile"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["trip_id"],
            ["trip.id"],
            name=op.f("fk_trip_collaborator_trip_id_trip"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user_profile.id"],
            name=op.f("fk_trip_collaborator_user_id_user_profile"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_trip_collaborator")),
        sa.UniqueConstraint("trip_id", "user_id", name="uq_trip_collaborator_trip_user"),
    )
    op.create_index(
        op.f("ix_trip_collaborator_trip_id"),
        "trip_collaborator",
        ["trip_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_trip_collaborator_user_id"),
        "trip_collaborator",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_trip_collaborator_invited_by_user_id"),
        "trip_collaborator",
        ["invited_by_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_trip_collaborator_trip_created",
        "trip_collaborator",
        ["trip_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "trip_invitation",
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("accepted_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("role", trip_access_role_enum, nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["accepted_by_user_id"],
            ["user_profile.id"],
            name=op.f("fk_trip_invitation_accepted_by_user_id_user_profile"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["user_profile.id"],
            name=op.f("fk_trip_invitation_created_by_user_id_user_profile"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["trip_id"],
            ["trip.id"],
            name=op.f("fk_trip_invitation_trip_id_trip"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_trip_invitation")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_trip_invitation_token_hash")),
    )
    op.create_index(
        op.f("ix_trip_invitation_trip_id"),
        "trip_invitation",
        ["trip_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_trip_invitation_created_by_user_id"),
        "trip_invitation",
        ["created_by_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_trip_invitation_accepted_by_user_id"),
        "trip_invitation",
        ["accepted_by_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_trip_invitation_token_hash"),
        "trip_invitation",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_trip_invitation_trip_created",
        "trip_invitation",
        ["trip_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_trip_invitation_trip_pending",
        "trip_invitation",
        ["trip_id", "revoked_at", "accepted_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_trip_invitation_trip_pending", table_name="trip_invitation")
    op.drop_index("ix_trip_invitation_trip_created", table_name="trip_invitation")
    op.drop_index(op.f("ix_trip_invitation_token_hash"), table_name="trip_invitation")
    op.drop_index(op.f("ix_trip_invitation_accepted_by_user_id"), table_name="trip_invitation")
    op.drop_index(op.f("ix_trip_invitation_created_by_user_id"), table_name="trip_invitation")
    op.drop_index(op.f("ix_trip_invitation_trip_id"), table_name="trip_invitation")
    op.drop_table("trip_invitation")

    op.drop_index("ix_trip_collaborator_trip_created", table_name="trip_collaborator")
    op.drop_index(op.f("ix_trip_collaborator_invited_by_user_id"), table_name="trip_collaborator")
    op.drop_index(op.f("ix_trip_collaborator_user_id"), table_name="trip_collaborator")
    op.drop_index(op.f("ix_trip_collaborator_trip_id"), table_name="trip_collaborator")
    op.drop_table("trip_collaborator")
