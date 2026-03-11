"""Expand place photo source refs for Google photo ids.

Revision ID: 20260311_0014
Revises: 20260311_0013
Create Date: 2026-03-11 14:45:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260311_0014"
down_revision: Union[str, Sequence[str], None] = "20260311_0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "place_photo",
        "source_media_ref",
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "place_photo",
        "source_media_ref",
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=False,
    )
