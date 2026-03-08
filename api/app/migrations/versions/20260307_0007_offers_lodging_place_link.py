"""Link lodging offers to places.

Revision ID: 20260307_0007
Revises: 20260306_0006
Create Date: 2026-03-07 09:30:00.000000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260307_0007"
down_revision = "20260306_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lodging_offer",
        sa.Column("place_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(op.f("ix_lodging_offer_place_id"), "lodging_offer", ["place_id"], unique=False)
    op.create_foreign_key(
        op.f("fk_lodging_offer_place_id_place"),
        "lodging_offer",
        "place",
        ["place_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_lodging_offer_place_id_place"), "lodging_offer", type_="foreignkey")
    op.drop_index(op.f("ix_lodging_offer_place_id"), table_name="lodging_offer")
    op.drop_column("lodging_offer", "place_id")
