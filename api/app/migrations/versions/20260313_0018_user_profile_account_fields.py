"""Add editable account fields to user profiles.

Revision ID: 20260313_0018
Revises: 20260312_0017
Create Date: 2026-03-13 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260313_0018"
down_revision: Union[str, Sequence[str], None] = "20260312_0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS email VARCHAR(255)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_user_profile_email ON user_profile (email)")
    op.execute("ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS first_name VARCHAR(255)")
    op.execute("ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS last_name VARCHAR(255)")
    op.execute("ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)")
    op.execute(
        "UPDATE user_profile SET display_name = COALESCE(NULLIF(display_name, ''), keycloak_sub)"
    )
    op.execute("ALTER TABLE user_profile ALTER COLUMN display_name SET NOT NULL")
    op.execute("ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS avatar_object_key TEXT")
    op.execute("ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS avatar_thumbnail_object_key TEXT")
    op.execute("ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS avatar_content_type VARCHAR(255)")
    op.execute("ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS avatar_size_bytes INTEGER")
    op.execute("ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS avatar_sha256 VARCHAR(64)")


def downgrade() -> None:
    op.execute("ALTER TABLE user_profile DROP COLUMN IF EXISTS avatar_sha256")
    op.execute("ALTER TABLE user_profile DROP COLUMN IF EXISTS avatar_size_bytes")
    op.execute("ALTER TABLE user_profile DROP COLUMN IF EXISTS avatar_content_type")
    op.execute("ALTER TABLE user_profile DROP COLUMN IF EXISTS avatar_thumbnail_object_key")
    op.execute("ALTER TABLE user_profile DROP COLUMN IF EXISTS avatar_object_key")
    op.execute("ALTER TABLE user_profile DROP COLUMN IF EXISTS last_name")
    op.execute("ALTER TABLE user_profile DROP COLUMN IF EXISTS first_name")
