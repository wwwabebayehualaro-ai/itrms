"""Import every model so `Base.metadata` is complete (Alembic autogenerate, create_all, tests)."""
from app.foundation.auth.models import RefreshToken, Tenant, User  # noqa: F401
from app.foundation.approval.model import ApprovalRequest  # noqa: F401
from app.foundation.audit.model import AuditLog  # noqa: F401
from app.foundation.idempotency.model import IdempotencyRecord  # noqa: F401
from app.foundation.numbering.model import NumberSequence  # noqa: F401
from app.foundation.registry.model import FeatureFlag  # noqa: F401
from app.modules.files.models.StoredFile import StoredFile  # noqa: F401
