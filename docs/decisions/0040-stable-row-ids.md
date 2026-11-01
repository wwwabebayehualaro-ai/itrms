# ADR 0040: Stable row ids in repeating sections

* Status: accepted (2026-10-31, task 0.21g). It extends the request change of task 0.21e (a patch) and form-platform.md
  G3 (stored answers stay readable).

## Context
* A repeating section's answers are a list of rows. Until now a row had no identity: only its place in the list.
* A request change (task 0.21e) is a patch of the answers its corrector may see and change. A section holding answers the
  corrector may not see (another role's column, a Sensitive one) could not be merged: with no identity, a row the
  corrector moved or deleted would carry another role's answers into the wrong row, or lose them. So such a section was
  refused whole.

## Decision
1. **Every row has an id**: the reserved key `_id` in the row (a field key always starts with a letter, so it never
   collides with a field). The engine makes it when a row is created (in the browser and on the server), and the server
   gives one to every row filed without one (or with a malformed or repeated one). Nothing shows, validates, exports or
   indexes it.
2. **A request change merges rows by id**: a row sent with a stored id is that row, changed in the columns the corrector
   may change. The columns they may not see or change (another role's, Sensitive ones, computed from the person) keep the
   stored answers of that row. A row sent without a known id is new. A stored row the corrector leaves out is deleted,
   unless it holds an answer they may not see or change: then the change is refused, never a loss of that answer. The
   server checks this on the result, whatever removed the row (a section the change hides through another answer too).
   A derived column its rules hide holds no value, as when filing.
3. **Sensitive columns** of a row keep their stored answers through a change (the corrector sees them masked); the row's
   other columns can be changed. A whole Sensitive section still cannot be changed through its case.
4. **Rows stored before this decision** (no ids) keep the earlier rule: a section holding answers the corrector may not
   see or change is refused whole, and so is one with a column computed from the person (its rows cannot keep who added
   each). They stay readable as they are (G3); their rows get ids with the request's next change that is written (ids
   alone are no change: no revision, nothing named as changed).

## Consequences
* A woreda head corrects a row of a section holding a records officer's column; that column's answers stay with their rows.
* The row id is part of the stored answers: it must survive every value helper (taken values, settled values, drafts).
* Deleting another role's row through a correction is refused; that office deletes it, or the case's workflow does.
* A column computed from the person counts as kept only in a section's own rows: one in a nested section still keeps
  that section as filed (nested rows are not merged one by one).
