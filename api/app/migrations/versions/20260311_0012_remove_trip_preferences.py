"""Remove trip-level preferences.

Revision ID: 20260311_0012
Revises: 20260310_0011
Create Date: 2026-03-11 09:30:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260311_0012"
down_revision: Union[str, Sequence[str], None] = "20260310_0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("trip", "preferences_json")


def downgrade() -> None:
    op.add_column(
        "trip",
        sa.Column(
            "preferences_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.alter_column("trip", "preferences_json", server_default=None)
