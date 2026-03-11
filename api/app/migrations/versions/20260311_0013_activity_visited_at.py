"""Add visited_at to planner activities.

Revision ID: 20260311_0013
Revises: 20260311_0012
Create Date: 2026-03-11 15:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260311_0013"
down_revision: Union[str, Sequence[str], None] = "20260311_0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("activity", sa.Column("visited_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("activity", "visited_at")
