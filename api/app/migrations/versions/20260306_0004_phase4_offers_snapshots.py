"""phase4 offers snapshots and lineage

Revision ID: 20260306_0004
Revises: 20260306_0003
Create Date: 2026-03-06 16:05:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260306_0004"
down_revision: Union[str, None] = "20260306_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "transport_offer",
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trip_day_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("provider_offer_ref", sa.String(length=255), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("transport_mode", sa.String(length=32), nullable=True),
        sa.Column("origin_text", sa.String(length=255), nullable=True),
        sa.Column("destination_text", sa.String(length=255), nullable=True),
        sa.Column("depart_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("arrive_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("price_amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("deep_link", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("superseded_by_offer_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("raw_payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "superseded_by_offer_id IS NULL OR superseded_by_offer_id <> id",
            name="ck_transport_offer_not_self_superseded",
        ),
        sa.ForeignKeyConstraint(
            ["superseded_by_offer_id"],
            ["transport_offer.id"],
            name=op.f("fk_transport_offer_superseded_by_offer_id_transport_offer"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["trip_day_id"],
            ["trip_day.id"],
            name=op.f("fk_transport_offer_trip_day_id_trip_day"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["trip_id"],
            ["trip.id"],
            name=op.f("fk_transport_offer_trip_id_trip"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_transport_offer")),
    )
    op.create_index(
        op.f("ix_transport_offer_trip_id"), "transport_offer", ["trip_id"], unique=False
    )
    op.create_index(
        op.f("ix_transport_offer_trip_day_id"), "transport_offer", ["trip_day_id"], unique=False
    )
    op.create_index(
        op.f("ix_transport_offer_provider"), "transport_offer", ["provider"], unique=False
    )
    op.create_index(
        op.f("ix_transport_offer_request_fingerprint"),
        "transport_offer",
        ["request_fingerprint"],
        unique=False,
    )
    op.create_index(
        op.f("ix_transport_offer_expires_at"), "transport_offer", ["expires_at"], unique=False
    )
    op.create_index(
        op.f("ix_transport_offer_is_current"), "transport_offer", ["is_current"], unique=False
    )
    op.create_index(
        op.f("ix_transport_offer_superseded_by_offer_id"),
        "transport_offer",
        ["superseded_by_offer_id"],
        unique=False,
    )
    op.create_index(
        "ix_transport_offer_trip_created",
        "transport_offer",
        ["trip_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "lodging_offer",
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trip_day_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("provider_offer_ref", sa.String(length=255), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("location_text", sa.String(length=255), nullable=True),
        sa.Column("room_type", sa.String(length=128), nullable=True),
        sa.Column("checkin_date", sa.Date(), nullable=True),
        sa.Column("checkout_date", sa.Date(), nullable=True),
        sa.Column("nights", sa.Integer(), nullable=True),
        sa.Column("price_amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("deep_link", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("superseded_by_offer_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("raw_payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "superseded_by_offer_id IS NULL OR superseded_by_offer_id <> id",
            name="ck_lodging_offer_not_self_superseded",
        ),
        sa.ForeignKeyConstraint(
            ["superseded_by_offer_id"],
            ["lodging_offer.id"],
            name=op.f("fk_lodging_offer_superseded_by_offer_id_lodging_offer"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["trip_day_id"],
            ["trip_day.id"],
            name=op.f("fk_lodging_offer_trip_day_id_trip_day"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["trip_id"],
            ["trip.id"],
            name=op.f("fk_lodging_offer_trip_id_trip"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lodging_offer")),
    )
    op.create_index(op.f("ix_lodging_offer_trip_id"), "lodging_offer", ["trip_id"], unique=False)
    op.create_index(
        op.f("ix_lodging_offer_trip_day_id"), "lodging_offer", ["trip_day_id"], unique=False
    )
    op.create_index(op.f("ix_lodging_offer_provider"), "lodging_offer", ["provider"], unique=False)
    op.create_index(
        op.f("ix_lodging_offer_request_fingerprint"),
        "lodging_offer",
        ["request_fingerprint"],
        unique=False,
    )
    op.create_index(
        op.f("ix_lodging_offer_expires_at"), "lodging_offer", ["expires_at"], unique=False
    )
    op.create_index(
        op.f("ix_lodging_offer_is_current"), "lodging_offer", ["is_current"], unique=False
    )
    op.create_index(
        op.f("ix_lodging_offer_superseded_by_offer_id"),
        "lodging_offer",
        ["superseded_by_offer_id"],
        unique=False,
    )
    op.create_index(
        "ix_lodging_offer_trip_created", "lodging_offer", ["trip_id", "created_at"], unique=False
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION validate_transport_offer_trip_day()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.trip_day_id IS NULL THEN
            RETURN NEW;
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM trip_day td
            WHERE td.id = NEW.trip_day_id
              AND td.trip_id = NEW.trip_id
          ) THEN
            RAISE EXCEPTION 'trip_day_id % does not belong to trip_id %', NEW.trip_day_id, NEW.trip_id
              USING ERRCODE = '23514';
          END IF;

          RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_transport_offer_trip_day_matches_trip
        BEFORE INSERT OR UPDATE ON transport_offer
        FOR EACH ROW
        EXECUTE FUNCTION validate_transport_offer_trip_day();
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION validate_lodging_offer_trip_day()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.trip_day_id IS NULL THEN
            RETURN NEW;
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM trip_day td
            WHERE td.id = NEW.trip_day_id
              AND td.trip_id = NEW.trip_id
          ) THEN
            RAISE EXCEPTION 'trip_day_id % does not belong to trip_id %', NEW.trip_day_id, NEW.trip_id
              USING ERRCODE = '23514';
          END IF;

          RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_lodging_offer_trip_day_matches_trip
        BEFORE INSERT OR UPDATE ON lodging_offer
        FOR EACH ROW
        EXECUTE FUNCTION validate_lodging_offer_trip_day();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_lodging_offer_trip_day_matches_trip ON lodging_offer")
    op.execute("DROP FUNCTION IF EXISTS validate_lodging_offer_trip_day")
    op.execute(
        "DROP TRIGGER IF EXISTS trg_transport_offer_trip_day_matches_trip ON transport_offer"
    )
    op.execute("DROP FUNCTION IF EXISTS validate_transport_offer_trip_day")

    op.drop_index("ix_lodging_offer_trip_created", table_name="lodging_offer")
    op.drop_index(op.f("ix_lodging_offer_superseded_by_offer_id"), table_name="lodging_offer")
    op.drop_index(op.f("ix_lodging_offer_is_current"), table_name="lodging_offer")
    op.drop_index(op.f("ix_lodging_offer_expires_at"), table_name="lodging_offer")
    op.drop_index(op.f("ix_lodging_offer_request_fingerprint"), table_name="lodging_offer")
    op.drop_index(op.f("ix_lodging_offer_provider"), table_name="lodging_offer")
    op.drop_index(op.f("ix_lodging_offer_trip_day_id"), table_name="lodging_offer")
    op.drop_index(op.f("ix_lodging_offer_trip_id"), table_name="lodging_offer")
    op.drop_table("lodging_offer")

    op.drop_index("ix_transport_offer_trip_created", table_name="transport_offer")
    op.drop_index(op.f("ix_transport_offer_superseded_by_offer_id"), table_name="transport_offer")
    op.drop_index(op.f("ix_transport_offer_is_current"), table_name="transport_offer")
    op.drop_index(op.f("ix_transport_offer_expires_at"), table_name="transport_offer")
    op.drop_index(op.f("ix_transport_offer_request_fingerprint"), table_name="transport_offer")
    op.drop_index(op.f("ix_transport_offer_provider"), table_name="transport_offer")
    op.drop_index(op.f("ix_transport_offer_trip_day_id"), table_name="transport_offer")
    op.drop_index(op.f("ix_transport_offer_trip_id"), table_name="transport_offer")
    op.drop_table("transport_offer")
