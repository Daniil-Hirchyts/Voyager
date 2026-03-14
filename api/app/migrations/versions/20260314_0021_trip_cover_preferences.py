"""trip cover preferences

Revision ID: 20260314_0021
Revises: 20260313_0020
Create Date: 2026-03-14 12:00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260314_0021"
down_revision: Union[str, None] = "20260313_0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "trip",
        sa.Column(
            "cover_preference_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.alter_column("trip", "cover_preference_json", server_default=None)


def downgrade() -> None:
    op.drop_column("trip", "cover_preference_json")
