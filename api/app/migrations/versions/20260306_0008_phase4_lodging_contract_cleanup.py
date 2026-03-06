"""lodging contract cleanup

Revision ID: 20260306_0008
Revises: 20260306_0007
Create Date: 2026-03-06 23:55:00

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260306_0008"
down_revision: Union[str, None] = "20260306_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM lodging_offer
        WHERE provider = 'expedia_lodging'
           OR lodging_type = 'rental'
        """
    )
    op.drop_constraint("ck_lodging_offer_lodging_type_values", "lodging_offer", type_="check")
    op.create_check_constraint(
        "ck_lodging_offer_lodging_type_values",
        "lodging_offer",
        "lodging_type IS NULL OR lodging_type IN ('hotel')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_lodging_offer_lodging_type_values", "lodging_offer", type_="check")
    op.create_check_constraint(
        "ck_lodging_offer_lodging_type_values",
        "lodging_offer",
        "lodging_type IS NULL OR lodging_type IN ('hotel', 'rental')",
    )
