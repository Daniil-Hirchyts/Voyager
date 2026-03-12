"""Add trip route travel mode.

Revision ID: 20260312_0017
Revises: 20260312_0016
Create Date: 2026-03-12 10:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260312_0017"
down_revision: Union[str, Sequence[str], None] = "20260312_0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "trip",
        sa.Column("route_travel_mode", sa.String(length=16), nullable=False, server_default="WALK"),
    )
    op.execute("UPDATE trip SET route_travel_mode = 'WALK' WHERE route_travel_mode IS NULL")
    op.alter_column("trip", "route_travel_mode", server_default=None)


def downgrade() -> None:
    op.drop_column("trip", "route_travel_mode")
