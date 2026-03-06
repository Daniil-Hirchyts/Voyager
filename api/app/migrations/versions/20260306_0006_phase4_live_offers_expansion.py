"""phase4 live offers expansion

Revision ID: 20260306_0006
Revises: 20260306_0005
Create Date: 2026-03-06 18:15:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260306_0006"
down_revision: Union[str, None] = "20260306_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("lodging_offer", sa.Column("lodging_type", sa.String(length=32), nullable=True))
    op.create_index(op.f("ix_lodging_offer_lodging_type"), "lodging_offer", ["lodging_type"], unique=False)
    op.create_check_constraint(
        "ck_lodging_offer_lodging_type_values",
        "lodging_offer",
        "lodging_type IS NULL OR lodging_type IN ('hotel', 'rental')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_lodging_offer_lodging_type_values", "lodging_offer", type_="check")
    op.drop_index(op.f("ix_lodging_offer_lodging_type"), table_name="lodging_offer")
    op.drop_column("lodging_offer", "lodging_type")
