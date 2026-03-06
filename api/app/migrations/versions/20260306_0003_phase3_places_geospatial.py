"""phase3 places geospatial and dedup lineage

Revision ID: 20260306_0003
Revises: 20260306_0002
Create Date: 2026-03-06 13:00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260306_0003"
down_revision: Union[str, None] = "20260306_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "place", sa.Column("canonical_place_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column("place", sa.Column("dedup_confidence", sa.Float(), nullable=True))
    op.add_column("place", sa.Column("merged_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("ALTER TABLE place ADD COLUMN geom geography(Point,4326)")

    op.create_foreign_key(
        "fk_place_canonical_place_id_place",
        "place",
        "place",
        ["canonical_place_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_place_canonical_place_id"), "place", ["canonical_place_id"], unique=False
    )
    op.create_index(
        "ix_place_geom_gist",
        "place",
        ["geom"],
        unique=False,
        postgresql_using="gist",
    )
    op.create_index(
        "ix_place_metadata_json_gin",
        "place",
        ["metadata_json"],
        unique=False,
        postgresql_using="gin",
    )

    op.create_check_constraint(
        "ck_place_lat_range",
        "place",
        "(lat IS NULL) OR (lat >= -90 AND lat <= 90)",
    )
    op.create_check_constraint(
        "ck_place_lon_range",
        "place",
        "(lon IS NULL) OR (lon >= -180 AND lon <= 180)",
    )
    op.create_check_constraint(
        "ck_place_lat_lon_pair_consistency",
        "place",
        "((lat IS NULL AND lon IS NULL) OR (lat IS NOT NULL AND lon IS NOT NULL))",
    )
    op.create_check_constraint(
        "ck_place_not_self_canonical",
        "place",
        "(canonical_place_id IS NULL) OR (canonical_place_id <> id)",
    )
    op.create_check_constraint(
        "ck_place_dedup_confidence_range",
        "place",
        "(dedup_confidence IS NULL) OR (dedup_confidence >= 0 AND dedup_confidence <= 1)",
    )

    op.execute(
        """
        UPDATE place
        SET geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
        WHERE lat IS NOT NULL AND lon IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_constraint("ck_place_dedup_confidence_range", "place", type_="check")
    op.drop_constraint("ck_place_not_self_canonical", "place", type_="check")
    op.drop_constraint("ck_place_lat_lon_pair_consistency", "place", type_="check")
    op.drop_constraint("ck_place_lon_range", "place", type_="check")
    op.drop_constraint("ck_place_lat_range", "place", type_="check")

    op.drop_index("ix_place_metadata_json_gin", table_name="place")
    op.drop_index("ix_place_geom_gist", table_name="place")
    op.drop_index(op.f("ix_place_canonical_place_id"), table_name="place")
    op.drop_constraint("fk_place_canonical_place_id_place", "place", type_="foreignkey")

    op.execute("ALTER TABLE place DROP COLUMN geom")
    op.drop_column("place", "merged_at")
    op.drop_column("place", "dedup_confidence")
    op.drop_column("place", "canonical_place_id")
