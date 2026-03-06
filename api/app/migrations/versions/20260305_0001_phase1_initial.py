"""phase1 initial schema

Revision ID: 20260305_0001
Revises:
Create Date: 2026-03-05 18:00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260305_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    job_status_enum = sa.Enum("PENDING", "RUNNING", "SUCCEEDED", "FAILED", name="job_status_enum")
    job_status_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "user_profile",
        sa.Column("keycloak_sub", sa.String(length=255), nullable=False),
        sa.Column("preferences_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_profile")),
        sa.UniqueConstraint("keycloak_sub", name=op.f("uq_user_profile_keycloak_sub")),
    )
    op.create_index(
        op.f("ix_user_profile_keycloak_sub"), "user_profile", ["keycloak_sub"], unique=True
    )

    op.create_table(
        "place",
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=128), nullable=True),
        sa.Column("address_text", sa.Text(), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_place")),
    )
    op.create_index(op.f("ix_place_name"), "place", ["name"], unique=False)
    op.create_index(
        "uq_place_source_external_id_not_null",
        "place",
        ["source", "external_id"],
        unique=True,
        postgresql_where=sa.text("external_id IS NOT NULL"),
    )

    op.create_table(
        "trip",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("destination_text", sa.String(length=255), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("budget_amount", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("budget_currency", sa.String(length=3), nullable=True),
        sa.Column("trip_type", sa.String(length=64), nullable=True),
        sa.Column("preferences_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("end_date >= start_date", name=op.f("ck_trip_trip_valid_date_range")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user_profile.id"],
            name=op.f("fk_trip_user_id_user_profile"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_trip")),
    )
    op.create_index(op.f("ix_trip_user_id"), "trip", ["user_id"], unique=False)
    op.create_index(op.f("ix_trip_version"), "trip", ["version"], unique=False)

    op.create_table(
        "job",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("job_type", sa.String(length=64), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "PENDING",
                "RUNNING",
                "SUCCEEDED",
                "FAILED",
                name="job_status_enum",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("result_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user_profile.id"],
            name=op.f("fk_job_user_id_user_profile"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_job")),
    )
    op.create_index(op.f("ix_job_user_id"), "job", ["user_id"], unique=False)

    op.create_table(
        "trip_day",
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("day_index", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["trip_id"], ["trip.id"], name=op.f("fk_trip_day_trip_id_trip"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_trip_day")),
        sa.UniqueConstraint("trip_id", "day_index", name="uq_trip_day_trip_id_day_index"),
    )
    op.create_index(op.f("ix_trip_day_trip_id"), "trip_day", ["trip_id"], unique=False)

    op.create_table(
        "activity",
        sa.Column("trip_day_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_time", sa.Time(), nullable=True),
        sa.Column("duration_min", sa.Integer(), nullable=True),
        sa.Column("tags_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("estimated_cost_amount", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("estimated_cost_currency", sa.String(length=3), nullable=True),
        sa.Column("place_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_favorite", sa.Boolean(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["place_id"], ["place.id"], name=op.f("fk_activity_place_id_place"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["trip_day_id"],
            ["trip_day.id"],
            name=op.f("fk_activity_trip_day_id_trip_day"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_activity")),
        sa.UniqueConstraint("trip_day_id", "order_index", name="uq_activity_trip_day_order"),
    )
    op.create_index(op.f("ix_activity_place_id"), "activity", ["place_id"], unique=False)
    op.create_index(op.f("ix_activity_trip_day_id"), "activity", ["trip_day_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_activity_trip_day_id"), table_name="activity")
    op.drop_index(op.f("ix_activity_place_id"), table_name="activity")
    op.drop_table("activity")

    op.drop_index(op.f("ix_trip_day_trip_id"), table_name="trip_day")
    op.drop_table("trip_day")

    op.drop_index(op.f("ix_job_user_id"), table_name="job")
    op.drop_table("job")

    op.drop_index(op.f("ix_trip_version"), table_name="trip")
    op.drop_index(op.f("ix_trip_user_id"), table_name="trip")
    op.drop_table("trip")

    op.drop_index("uq_place_source_external_id_not_null", table_name="place")
    op.drop_index(op.f("ix_place_name"), table_name="place")
    op.drop_table("place")

    op.drop_index(op.f("ix_user_profile_keycloak_sub"), table_name="user_profile")
    op.drop_table("user_profile")

    job_status_enum = sa.Enum("PENDING", "RUNNING", "SUCCEEDED", "FAILED", name="job_status_enum")
    job_status_enum.drop(op.get_bind(), checkfirst=True)
