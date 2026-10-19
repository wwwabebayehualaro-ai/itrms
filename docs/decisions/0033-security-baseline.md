# ADR 0033: Security baseline: ASVS 5.0, the INSA national standard, and one security standard for every slice

* Status: accepted (2026-10-19). It **updates** the security targets in `docs/architecture.md` §18 and `docs/engineering/nfr.md`
  (ASVS 4 → ASVS 5.0), and **amends**:
  * ADR-0004: WebAuthn becomes mandatory for administrators (it was optional);
  * ADR-0021: an `Origin` check is added to the CSRF defence;
  * ADR-0024: Sensitive fields stay out of local drafts, commands carrying them are not queued offline, and the local
    key survives an idle sign-out (security standard SEC-WB-3).

## Context
* Security rules were spread over the architecture (§18), ADR-0004, ADR-0021, ADR-0031, the threat model and the NFRs.
  There was no single standard a developer, a reviewer or an auditor could check a change against.
* The NFRs targeted OWASP ASVS 4. **ASVS 5.0** was released in May 2025 and replaces it. NIST SP 800-63-4 (July 2025)
  replaces 800-63-3. The OWASP Top 10 was revised in 2025.
* INSA audits organisations against its **Critical Mass Cyber Security Requirement Standard (CMCSRS) v2.0**, and evaluates
  technology products against Common Criteria and other frameworks it accepts (*Cyber Security Audit and Evaluation
  Guideline* v1.0). The audit checks documents first, then tests that practice matches them, and scores maturity 0–100.
* CMCSRS 6.14(f) expects INSA to evaluate an information system's requirements and design **before** it is procured or
  developed, and 6.38(f)–(g) expect locally developed ICT products and services to be certified before they reach the
  market.
* **Proclamation 1426/2026** lists Transport and Government Services among the critical-infrastructure sectors. A
  designated bureau must obtain INSA security clearance before integrating new or upgraded ICT systems and report
  incidents within 48 hours.

## Decision
* **One security standard**, [`docs/platform/security.md`](../platform/security.md), with numbered rules (`SEC-…`). Every
  slice, app and installation follows it. Reviews, tests, the ASVS checklist and the INSA pack refer to rule ids.
* **Verification target:** OWASP ASVS **5.0 Level 2** for the whole application; **Level 3** for authentication,
  sessions, authorization, cryptography, the money path and audit.
* **Authentication:** NIST SP 800-63-4. Staff at AAL2 with mandatory MFA (no SMS or e-mail codes), with a passkey always
  offered. Administrators at AAL3 with a non-exportable phishing-resistant factor (a hardware key or a device-bound
  passkey; synced passkeys count as AAL2). Passwords of at least 12 characters, Argon2id, a breached list.
* **Where national and international rules differ, the national rule wins** and the difference is written down. Example:
  administrator passwords change every 90 days (CMCSRS 5.7(e)(5)), while staff passwords don't expire (800-63-4).
* **Step-up authentication:** MFA within the last 5 minutes for reveals, role grants and security settings; within the
  last 30 minutes for money approval and issuance, which clerks do all day.
* **Fix deadlines** for vulnerabilities: critical or exploited 7 days (mitigation within 72 hours), high 14 days (CMCSRS
  5.7(g)(4)), medium 30, low 90.
* **Incident deadlines:** the vendor tells the bureau within 24 hours; the bureau reports to Ethio-CERT within 48 hours
  (Proclamation 1426/2026) and personal-data breaches to the authority within 72 hours (PDP 1321/2024).
* **Data classification** in five ITRMS levels, all below CMCSRS's national-security levels. Data a bureau classifies
  CONFIDENTIAL or higher stays out of ITRMS unless INSA approves the cryptography.
* **Release evidence:** a CycloneDX SBOM and a cryptographic inventory (CBOM), signed images with SLSA provenance, a ZAP
  baseline scan, and a yearly external penetration test.
* **INSA early:** the requirements and design are offered to INSA for review before the pilot is procured, as CMCSRS 6.14(f)
  expects. The evaluation pack (task 1.19) is built from documents that exist from Phase 0.

## Consequences
* `docs/architecture.md` §18 and `docs/engineering/nfr.md` say ASVS 5.0; the threat model refers to the rule ids.
* New lint rules, tests and checks land with the tasks listed in the standard's §21 (0.6, 0.7, 0.9, 0.10, 0.14, 0.26).
* The product owner contacts INSA's Cyber Security Audit Division about the design-stage review and the *Web
  Applications Audit Request* requirements (form OF/AEAD/001).
* Each installation gets an incident runbook, an access-review report and a DPIA per service; task 1.19 assembles them.
