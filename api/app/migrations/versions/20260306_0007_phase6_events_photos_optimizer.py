"""phase6 live events, place photos, and itinerary proposals

Revision ID: 20260306_0007
Revises: 20260306_0006
Create Date: 2026-03-06 22:00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260306_0007"
down_revision: Union[str, None] = "20260306_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "event_snapshot",
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trip_day_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("provider_event_ref", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("timezone", sa.String(length=64), nullable=True),
        sa.Column("venue_name", sa.String(length=255), nullable=True),
        sa.Column("venue_address", sa.Text(), nullable=True),
        sa.Column("place_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("segment", sa.String(length=128), nullable=True),
        sa.Column("genre", sa.String(length=128), nullable=True),
        sa.Column("min_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("max_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=True),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("deep_link", sa.Text(), nullable=True),
        sa.Column("sales_status", sa.String(length=64), nullable=True),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("raw_payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["place_id"], ["place.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["trip_day_id"], ["trip_day.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["trip_id"], ["trip.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_event_snapshot_trip_id"), "event_snapshot", ["trip_id"], unique=False)
    op.create_index(
        op.f("ix_event_snapshot_trip_day_id"), "event_snapshot", ["trip_day_id"], unique=False
    )
    op.create_index(op.f("ix_event_snapshot_provider"), "event_snapshot", ["provider"], unique=False)
    op.create_index(op.f("ix_event_snapshot_place_id"), "event_snapshot", ["place_id"], unique=False)
    op.create_index(
        op.f("ix_event_snapshot_request_fingerprint"),
        "event_snapshot",
        ["request_fingerprint"],
        unique=False,
    )
    op.create_index("ix_event_snapshot_trip_created", "event_snapshot", ["trip_id", "created_at"], unique=False)
    op.create_index(
        "uq_event_snapshot_provider_ref_trip",
        "event_snapshot",
        ["provider", "provider_event_ref", "trip_id"],
        unique=True,
    )

    op.add_column("activity", sa.Column("event_snapshot_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index(op.f("ix_activity_event_snapshot_id"), "activity", ["event_snapshot_id"], unique=False)
    op.create_foreign_key(
        op.f("fk_activity_event_snapshot_id_event_snapshot"),
        "activity",
        "event_snapshot",
        ["event_snapshot_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "place_photo",
        sa.Column("place_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("source_media_ref", sa.String(length=255), nullable=False),
        sa.Column("image_url", sa.Text(), nullable=False),
        sa.Column("thumbnail_url", sa.Text(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("license_code", sa.String(length=64), nullable=True),
        sa.Column("license_url", sa.Text(), nullable=True),
        sa.Column("author_name", sa.String(length=255), nullable=True),
        sa.Column("author_url", sa.Text(), nullable=True),
        sa.Column("attribution_text", sa.Text(), nullable=True),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        sa.Column("raw_payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["place_id"], ["place.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_place_photo_place_id"), "place_photo", ["place_id"], unique=False)
    op.create_index(op.f("ix_place_photo_source"), "place_photo", ["source"], unique=False)
    op.create_index(op.f("ix_place_photo_is_primary"), "place_photo", ["is_primary"], unique=False)
    op.create_index("ix_place_photo_place_rank", "place_photo", ["place_id", "rank"], unique=False)
    op.create_index(
        "uq_place_photo_source_ref_place",
        "place_photo",
        ["place_id", "source", "source_media_ref"],
        unique=True,
    )

    op.create_table(
        "itinerary_proposal",
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("based_on_trip_version", sa.Integer(), nullable=False),
        sa.Column("objective", sa.String(length=64), nullable=False),
        sa.Column("scope_day_ids_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("summary_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("score_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["job.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["trip_id"], ["trip.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user_profile.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id"),
    )
    op.create_index(op.f("ix_itinerary_proposal_trip_id"), "itinerary_proposal", ["trip_id"], unique=False)
    op.create_index(op.f("ix_itinerary_proposal_user_id"), "itinerary_proposal", ["user_id"], unique=False)
    op.create_index(op.f("ix_itinerary_proposal_job_id"), "itinerary_proposal", ["job_id"], unique=False)
    op.create_index(op.f("ix_itinerary_proposal_status"), "itinerary_proposal", ["status"], unique=False)
    op.create_index(
        "ix_itinerary_proposal_trip_created",
        "itinerary_proposal",
        ["trip_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_itinerary_proposal_user_created",
        "itinerary_proposal",
        ["user_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "itinerary_proposal_activity",
        sa.Column("proposal_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trip_day_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_activity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_snapshot_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("place_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_time", sa.Time(), nullable=True),
        sa.Column("duration_min", sa.Integer(), nullable=True),
        sa.Column("estimated_cost_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("estimated_cost_currency", sa.String(length=3), nullable=True),
        sa.Column("tags_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("rationale_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("score_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["event_snapshot_id"], ["event_snapshot.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["place_id"], ["place.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["proposal_id"], ["itinerary_proposal.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_activity_id"], ["activity.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["trip_day_id"], ["trip_day.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "proposal_id",
            "trip_day_id",
            "order_index",
            name="uq_itinerary_proposal_activity_order",
        ),
    )
    op.create_index(
        op.f("ix_itinerary_proposal_activity_proposal_id"),
        "itinerary_proposal_activity",
        ["proposal_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_itinerary_proposal_activity_trip_day_id"),
        "itinerary_proposal_activity",
        ["trip_day_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_itinerary_proposal_activity_source_activity_id"),
        "itinerary_proposal_activity",
        ["source_activity_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_itinerary_proposal_activity_event_snapshot_id"),
        "itinerary_proposal_activity",
        ["event_snapshot_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_itinerary_proposal_activity_place_id"),
        "itinerary_proposal_activity",
        ["place_id"],
        unique=False,
    )
    op.create_index(
        "ix_itinerary_proposal_activity_proposal_order",
        "itinerary_proposal_activity",
        ["proposal_id", "order_index"],
        unique=False,
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION voyager_audit_trip_id(table_name text, row_data jsonb)
        RETURNS uuid
        LANGUAGE plpgsql
        STABLE
        AS $$
        DECLARE
          resolved uuid;
          day_id uuid;
          proposal_id uuid;
        BEGIN
          IF row_data IS NULL THEN
            RETURN NULL;
          END IF;

          IF table_name = 'trip' THEN
            RETURN NULLIF(row_data->>'id', '')::uuid;
          ELSIF table_name = 'trip_day' THEN
            RETURN NULLIF(row_data->>'trip_id', '')::uuid;
          ELSIF table_name = 'activity' THEN
            day_id := NULLIF(row_data->>'trip_day_id', '')::uuid;
            IF day_id IS NULL THEN
              RETURN NULL;
            END IF;
            SELECT td.trip_id INTO resolved FROM trip_day td WHERE td.id = day_id;
            RETURN resolved;
          ELSIF table_name = 'transport_offer' OR table_name = 'lodging_offer' OR table_name = 'event_snapshot' OR table_name = 'itinerary_proposal' THEN
            RETURN NULLIF(row_data->>'trip_id', '')::uuid;
          ELSIF table_name = 'itinerary_proposal_activity' THEN
            proposal_id := NULLIF(row_data->>'proposal_id', '')::uuid;
            IF proposal_id IS NULL THEN
              RETURN NULL;
            END IF;
            SELECT ip.trip_id INTO resolved FROM itinerary_proposal ip WHERE ip.id = proposal_id;
            RETURN resolved;
          ELSE
            RETURN NULL;
          END IF;
        END;
        $$;
        """
    )

    for table_name in (
        "event_snapshot",
        "place_photo",
        "itinerary_proposal",
        "itinerary_proposal_activity",
    ):
        op.execute(f"DROP TRIGGER IF EXISTS voyager_audit_{table_name} ON {table_name}")
        op.execute(
            f"""
            CREATE TRIGGER voyager_audit_{table_name}
            AFTER INSERT OR UPDATE OR DELETE ON {table_name}
            FOR EACH ROW EXECUTE FUNCTION voyager_audit_trigger()
            """
        )


def downgrade() -> None:
    for table_name in (
        "event_snapshot",
        "place_photo",
        "itinerary_proposal",
        "itinerary_proposal_activity",
    ):
        op.execute(f"DROP TRIGGER IF EXISTS voyager_audit_{table_name} ON {table_name};")

    op.execute(
        """
        CREATE OR REPLACE FUNCTION voyager_audit_trip_id(table_name text, row_data jsonb)
        RETURNS uuid
        LANGUAGE plpgsql
        STABLE
        AS $$
        DECLARE
          resolved uuid;
          day_id uuid;
        BEGIN
          IF row_data IS NULL THEN
            RETURN NULL;
          END IF;

          IF table_name = 'trip' THEN
            RETURN NULLIF(row_data->>'id', '')::uuid;
          ELSIF table_name = 'trip_day' THEN
            RETURN NULLIF(row_data->>'trip_id', '')::uuid;
          ELSIF table_name = 'activity' THEN
            day_id := NULLIF(row_data->>'trip_day_id', '')::uuid;
            IF day_id IS NULL THEN
              RETURN NULL;
            END IF;
            SELECT td.trip_id INTO resolved FROM trip_day td WHERE td.id = day_id;
            RETURN resolved;
          ELSIF table_name = 'transport_offer' OR table_name = 'lodging_offer' THEN
            RETURN NULLIF(row_data->>'trip_id', '')::uuid;
          ELSE
            RETURN NULL;
          END IF;
        END;
        $$;
        """
    )

    op.drop_index("ix_itinerary_proposal_activity_proposal_order", table_name="itinerary_proposal_activity")
    op.drop_index(op.f("ix_itinerary_proposal_activity_place_id"), table_name="itinerary_proposal_activity")
    op.drop_index(op.f("ix_itinerary_proposal_activity_event_snapshot_id"), table_name="itinerary_proposal_activity")
    op.drop_index(op.f("ix_itinerary_proposal_activity_source_activity_id"), table_name="itinerary_proposal_activity")
    op.drop_index(op.f("ix_itinerary_proposal_activity_trip_day_id"), table_name="itinerary_proposal_activity")
    op.drop_index(op.f("ix_itinerary_proposal_activity_proposal_id"), table_name="itinerary_proposal_activity")
    op.drop_table("itinerary_proposal_activity")

    op.drop_index("ix_itinerary_proposal_user_created", table_name="itinerary_proposal")
    op.drop_index("ix_itinerary_proposal_trip_created", table_name="itinerary_proposal")
    op.drop_index(op.f("ix_itinerary_proposal_status"), table_name="itinerary_proposal")
    op.drop_index(op.f("ix_itinerary_proposal_job_id"), table_name="itinerary_proposal")
    op.drop_index(op.f("ix_itinerary_proposal_user_id"), table_name="itinerary_proposal")
    op.drop_index(op.f("ix_itinerary_proposal_trip_id"), table_name="itinerary_proposal")
    op.drop_table("itinerary_proposal")

    op.drop_index("uq_place_photo_source_ref_place", table_name="place_photo")
    op.drop_index("ix_place_photo_place_rank", table_name="place_photo")
    op.drop_index(op.f("ix_place_photo_is_primary"), table_name="place_photo")
    op.drop_index(op.f("ix_place_photo_source"), table_name="place_photo")
    op.drop_index(op.f("ix_place_photo_place_id"), table_name="place_photo")
    op.drop_table("place_photo")

    op.drop_constraint(op.f("fk_activity_event_snapshot_id_event_snapshot"), "activity", type_="foreignkey")
    op.drop_index(op.f("ix_activity_event_snapshot_id"), table_name="activity")
    op.drop_column("activity", "event_snapshot_id")

    op.drop_index("uq_event_snapshot_provider_ref_trip", table_name="event_snapshot")
    op.drop_index("ix_event_snapshot_trip_created", table_name="event_snapshot")
    op.drop_index(op.f("ix_event_snapshot_request_fingerprint"), table_name="event_snapshot")
    op.drop_index(op.f("ix_event_snapshot_place_id"), table_name="event_snapshot")
    op.drop_index(op.f("ix_event_snapshot_provider"), table_name="event_snapshot")
    op.drop_index(op.f("ix_event_snapshot_trip_day_id"), table_name="event_snapshot")
    op.drop_index(op.f("ix_event_snapshot_trip_id"), table_name="event_snapshot")
    op.drop_table("event_snapshot")
