"""phase5 exports, audit logging, and hardening

Revision ID: 20260306_0005
Revises: 20260306_0004
Create Date: 2026-03-06 18:00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260306_0005"
down_revision: Union[str, None] = "20260306_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "trip_export",
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("format", sa.String(length=16), nullable=False),
        sa.Column("trip_version", sa.Integer(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=True),
        sa.Column("content_type", sa.String(length=128), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("error_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["job_id"], ["job.id"], name=op.f("fk_trip_export_job_id_job"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["trip_id"], ["trip.id"], name=op.f("fk_trip_export_trip_id_trip"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user_profile.id"],
            name=op.f("fk_trip_export_user_id_user_profile"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_trip_export")),
        sa.UniqueConstraint("job_id", name=op.f("uq_trip_export_job_id")),
    )
    op.create_index(op.f("ix_trip_export_job_id"), "trip_export", ["job_id"], unique=False)
    op.create_index(op.f("ix_trip_export_user_id"), "trip_export", ["user_id"], unique=False)
    op.create_index(op.f("ix_trip_export_trip_id"), "trip_export", ["trip_id"], unique=False)
    op.create_index(
        "ix_trip_export_trip_created_desc", "trip_export", ["trip_id", "created_at"], unique=False
    )
    op.create_index(
        "ix_trip_export_user_created_desc", "trip_export", ["user_id", "created_at"], unique=False
    )

    op.create_table(
        "audit_log",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("before_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("after_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("correlation_id", sa.String(length=64), nullable=True),
        sa.Column("request_path", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_log")),
    )
    op.create_index(op.f("ix_audit_log_user_id"), "audit_log", ["user_id"], unique=False)
    op.create_index(op.f("ix_audit_log_trip_id"), "audit_log", ["trip_id"], unique=False)
    op.create_index(
        "ix_audit_log_trip_created_desc", "audit_log", ["trip_id", "created_at"], unique=False
    )
    op.create_index(
        "ix_audit_log_user_created_desc", "audit_log", ["user_id", "created_at"], unique=False
    )
    op.create_index(
        "ix_audit_log_entity_created_desc",
        "audit_log",
        ["entity_type", "entity_id", "created_at"],
        unique=False,
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION voyager_redact_json(input jsonb)
        RETURNS jsonb
        LANGUAGE plpgsql
        IMMUTABLE
        AS $$
        DECLARE
          result jsonb;
          k text;
          v jsonb;
        BEGIN
          IF input IS NULL THEN
            RETURN NULL;
          END IF;

          CASE jsonb_typeof(input)
            WHEN 'object' THEN
              result := '{}'::jsonb;
              FOR k, v IN SELECT * FROM jsonb_each(input)
              LOOP
                IF k = 'raw_payload_json'
                   OR k ILIKE '%token%'
                   OR k ILIKE '%secret%'
                   OR k ILIKE '%password%'
                   OR k ILIKE '%api_key%' THEN
                  result := result || jsonb_build_object(k, '[REDACTED]');
                ELSE
                  result := result || jsonb_build_object(k, voyager_redact_json(v));
                END IF;
              END LOOP;
              RETURN result;
            WHEN 'array' THEN
              RETURN COALESCE(
                (SELECT jsonb_agg(voyager_redact_json(value)) FROM jsonb_array_elements(input)),
                '[]'::jsonb
              );
            ELSE
              RETURN input;
          END CASE;
        END;
        $$;
        """
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

    op.execute(
        """
        CREATE OR REPLACE FUNCTION voyager_audit_trigger()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
          before_data jsonb;
          after_data jsonb;
          row_data jsonb;
          audit_user_id uuid;
          audit_entity_id uuid;
          audit_trip_id uuid;
          audit_correlation_id text;
          audit_request_path text;
        BEGIN
          IF TG_OP = 'INSERT' THEN
            before_data := NULL;
            after_data := voyager_redact_json(to_jsonb(NEW));
            row_data := to_jsonb(NEW);
          ELSIF TG_OP = 'UPDATE' THEN
            before_data := voyager_redact_json(to_jsonb(OLD));
            after_data := voyager_redact_json(to_jsonb(NEW));
            row_data := to_jsonb(NEW);
          ELSE
            before_data := voyager_redact_json(to_jsonb(OLD));
            after_data := NULL;
            row_data := to_jsonb(OLD);
          END IF;

          BEGIN
            audit_user_id := NULLIF(current_setting('voyager.audit_user_id', true), '')::uuid;
          EXCEPTION WHEN invalid_text_representation THEN
            audit_user_id := NULL;
          END;

          BEGIN
            audit_entity_id := NULLIF(row_data->>'id', '')::uuid;
          EXCEPTION WHEN invalid_text_representation THEN
            audit_entity_id := NULL;
          END;

          audit_trip_id := voyager_audit_trip_id(TG_TABLE_NAME, row_data);
          audit_correlation_id := NULLIF(current_setting('voyager.audit_correlation_id', true), '');
          audit_request_path := NULLIF(current_setting('voyager.audit_request_path', true), '');

          INSERT INTO audit_log (
            id,
            user_id,
            trip_id,
            entity_type,
            entity_id,
            action,
            before_json,
            after_json,
            correlation_id,
            request_path,
            created_at
          ) VALUES (
            gen_random_uuid(),
            audit_user_id,
            audit_trip_id,
            TG_TABLE_NAME,
            audit_entity_id,
            TG_OP,
            before_data,
            after_data,
            audit_correlation_id,
            audit_request_path,
            now()
          );

          IF TG_OP = 'DELETE' THEN
            RETURN OLD;
          END IF;
          RETURN NEW;
        END;
        $$;
        """
    )

    for table_name in (
        "trip",
        "trip_day",
        "activity",
        "place",
        "transport_offer",
        "lodging_offer",
        "user_profile",
    ):
        op.execute(
            f"""
            CREATE TRIGGER trg_audit_{table_name}
            AFTER INSERT OR UPDATE OR DELETE ON {table_name}
            FOR EACH ROW
            EXECUTE FUNCTION voyager_audit_trigger();
            """
        )


def downgrade() -> None:
    for table_name in (
        "user_profile",
        "lodging_offer",
        "transport_offer",
        "place",
        "activity",
        "trip_day",
        "trip",
    ):
        op.execute(f"DROP TRIGGER IF EXISTS trg_audit_{table_name} ON {table_name}")

    op.execute("DROP FUNCTION IF EXISTS voyager_audit_trigger")
    op.execute("DROP FUNCTION IF EXISTS voyager_audit_trip_id(text, jsonb)")
    op.execute("DROP FUNCTION IF EXISTS voyager_redact_json(jsonb)")

    op.drop_index("ix_audit_log_entity_created_desc", table_name="audit_log")
    op.drop_index("ix_audit_log_user_created_desc", table_name="audit_log")
    op.drop_index("ix_audit_log_trip_created_desc", table_name="audit_log")
    op.drop_index(op.f("ix_audit_log_trip_id"), table_name="audit_log")
    op.drop_index(op.f("ix_audit_log_user_id"), table_name="audit_log")
    op.drop_table("audit_log")

    op.drop_index("ix_trip_export_user_created_desc", table_name="trip_export")
    op.drop_index("ix_trip_export_trip_created_desc", table_name="trip_export")
    op.drop_index(op.f("ix_trip_export_trip_id"), table_name="trip_export")
    op.drop_index(op.f("ix_trip_export_user_id"), table_name="trip_export")
    op.drop_index(op.f("ix_trip_export_job_id"), table_name="trip_export")
    op.drop_table("trip_export")
