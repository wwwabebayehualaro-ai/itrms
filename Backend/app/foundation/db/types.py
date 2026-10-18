from sqlalchemy import JSON, Uuid
from sqlalchemy.dialects.postgresql import JSONB

GUID = Uuid(as_uuid=True)
# JSONB on PostgreSQL, plain JSON elsewhere (keeps unit tests runnable on SQLite).
JSONType = JSON().with_variant(JSONB(), "postgresql")
