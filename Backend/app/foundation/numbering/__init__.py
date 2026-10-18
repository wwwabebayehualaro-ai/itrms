"""Document numbers: per-tenant, gapless, human-readable sequences (PO-2026-00042).

    numbering.register("purchase_order", title="Purchase orders", pattern="PO-{yyyy}-{seq:05}", reset="yearly")
    number = await numbering.next_number(session, "purchase_order")      # inside the transaction that saves the document

The counter is advanced with one atomic UPDATE in the caller's transaction: a rolled-back document gives its number back, so
numbers have no gaps, and two concurrent documents never get the same number.
"""
from app.foundation.numbering.sequences import SequenceDefinition, next_number, register  # noqa: F401
