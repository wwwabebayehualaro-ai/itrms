from app.foundation.registry.spec import ModuleSpec, NavGroup, NavItem, RouterMount
from app.modules.core_banking.routers import core_banking_router

SPEC = ModuleSpec(
    key="core_banking",
    title="Core banking",
    kind="coded",
    description="Accounts and teller transactions (a simulated core; services/gateway.py is the boundary to a real one). "
                "Its server action posts the cash deposit / withdrawal form.",
    depends_on=("form_submission",),  # the cash form's requests run this module's server action
    routers=(RouterMount(core_banking_router.router),),
    nav=(
        NavGroup("Teller", order=45, items=(
            NavItem("Accounts", route="/core-banking/accounts", icon="landmark", permission="account:read"),
        )),
    ),
)
