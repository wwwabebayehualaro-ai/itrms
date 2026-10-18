"""Maker-checker approvals.

A module asks for approval in code and says what happens on the decision (a *policy*); the platform stores the request,
enforces who may decide (a permission, and never the maker), runs the decision's effect in the same transaction as the
decision, audits it, and serves the inbox.

    approval.register_policy(
        "invoice.post", title="Post an invoice", approver_permission="invoice:approve",
        on_approved=post_invoice, on_rejected=reopen_invoice,
    )
    # in the module's service, inside its transaction:
    await ApprovalService(session).submit("invoice.post", resource_type="invoices", resource_id=str(inv.id),
                                          title=f"Post invoice {inv.number}", payload={"total": str(inv.total)})
"""
from app.foundation.approval.policy import ApprovalPolicy, register_policy  # noqa: F401
