# ADR 0037: Mandatory data classes of form answers

* Status: accepted (2026-10-31, task 0.21e; the product owner chose "the state-of-the-art, enterprise-grade approach").
  It makes precise SEC-DC-1 and SEC-PD-2 of [security.md](../platform/security.md) for form answers.

## Context
* A form field's answer has a data class (`public`, `internal`, `personal`, `sensitive`; task 0.20c). The class decides
  what leaves the server: a Sensitive answer is masked in lists and exports and is shown only through the audited reveal
  (0.20d), and the browser keeps no draft of it (SEC-WB-3).
* Three texts disagreed (follow-up from 0.20d):
  * SEC-DC-1: an unlabelled field is a review failure, and unclassified assets are not released (CMCSRS 6.17(d));
  * the classification table: Personal data is "masked in exports";
  * the code: an unset class counts as Personal; lists and exports show Personal answers in clear and mask Sensitive ones
    only; the builder only warned of a field without a class.
* Label policies in enterprise data protection (Microsoft Purview sensitivity labels, Google Cloud DLP) work in two steps:
  a **default label** on new content, so nothing is born unlabelled, and **mandatory labelling**, so nothing is shared
  without one. Field-level masking is kept for the highest class. Below it, access control and an audit trail decide
  who reads in clear: masking every name and address would make a bureau's lists and exports useless for their purpose
  (PDP 1321/2024 allows processing for the purpose collected, by those who need it).

## Decision
1. **Default label:** the builder gives every new field that holds an answer (an input, a repeating section) the
   default class, Personal. Its author changes it in the inspector.
2. **Mandatory labelling:** the lint rule `unclassified` is an error. Publishing refuses a form version with an
   answer-holding field without a class, with the rule's message in Amharic and English (the publish review lists it).
3. **What each class means for answers:**
   * Sensitive: masked in lists, exports, audit diffs and logs; shown only through the audited reveal; never kept in the
     browser.
   * Personal: in clear only to staff who may read the record (RLS and roles, field restrictions), in lists and in
     exports. Every export is a request on record, made with the asker's scope and roles, and every download is audited.
     HMAC-masked in audit diffs, never in logs.
   * Internal and Public: as the classification table says.
4. **Versions published before classes existed** keep working: an unset class counts as Personal on screen and as
   Sensitive for what leaves the server (the browser's drafts keep none of it). A new version of such a form needs its
   classes.

## Consequences
* SEC-DC-1's "not released" is enforced mechanically for form fields at publish, not left to a reviewer's eye. Tables
  keep the slice check.
* Test fixtures and demo forms that publish forms give their fields a class (most of them Personal).
* A form author who wants a Sensitive answer still has to choose it. The lint rule `sensitive-filterable` keeps such a
  field out of the filter index.
