"""Import every model so `Base.metadata` is complete (Alembic autogenerate, create_all, tests)."""
from app.foundation.auth.models import RefreshToken, Tenant, User  # noqa: F401
from app.foundation.approval.model import ApprovalRequest  # noqa: F401
from app.foundation.audit.model import AuditLog  # noqa: F401
from app.foundation.idempotency.model import IdempotencyRecord  # noqa: F401
from app.foundation.numbering.model import NumberSequence  # noqa: F401
from app.foundation.registry.model import FeatureFlag  # noqa: F401
from app.modules.core_banking.models.Account import Account  # noqa: F401
from app.modules.core_banking.models.BankTransaction import BankTransaction  # noqa: F401
from app.modules.core_banking.models.LedgerEntry import LedgerEntry  # noqa: F401
from app.modules.files.models.StoredFile import StoredFile  # noqa: F401
from app.modules.form_submission.models.FormSubmission import FormSubmission  # noqa: F401
from app.modules.form_builder.models.FormTemplate import FormTemplate  # noqa: F401
from app.modules.form_builder.models.TemplateVersion import TemplateVersion  # noqa: F401
from app.modules.form_submission.models.SavedView import SavedView  # noqa: F401
