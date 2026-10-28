# Threat model (initial, STRIDE)

The baseline for the INSA security evaluation. Each phase updates it, and each threat maps to its controls and the test or
task that proves them. The controls are specified as rules in the [security standard](../platform/security.md).
Assets, in order of importance:
1. citizens' personal data (Fayda FIN, phone, medical data);
2. money (fees, receipts, payroll list);
3. the integrity of issued documents and registries;
4. the audit trail;
5. availability during working hours.

## Actors
* **Insider staff:** curious, careless, or corrupt. This is the most likely threat for a government system that handles
  licences and money.
* External attacker on the internet (verification host, any exposed staff host).
* Compromised office PC (malware, shared accounts).
* Rogue or careless administrator (bureau or vendor).
* Compromised integration partner or supply chain.

## Threats and controls

| # | STRIDE | Threat | Controls | Proven by |
|---|---|---|---|---|
| 1 | Spoofing | stolen staff password / shared PC | 2FA (TOTP, hardware token, passkey); idle timeout; session list and revoke; brute-force detection | 0.10 e2e |
| 2 | Spoofing | forged licence, bolo or receipt | Ed25519-signed QR, offline verifier, online revocation status, gapless receipts, stationery serials | 0.23, 1.12a |
| 3 | Spoofing | fake "paid at revenue office" reference | unique external references, second-person verification or statement matching | 0.22 |
| 4 | Tampering | staff alter a case or registry record outside the workflow | no generic status updates; transitions only; class-R write scope; maker-checker; audit | 0.9, 0.19 |
| 5 | Tampering | admin edits the database directly to hide fraud | hash-chained audit, signed daily digest off-site, DB roles without UPDATE on audit | 0.7, 0.26 drill |
| 6 | Tampering | injected markup in issued PDFs | escaped templates, JavaScript-free renderer, CSP | 0.23 |
| 7 | Repudiation | "I didn't approve that" | per-user actions with unit, time, IP and request id in the audit; no shared accounts | 0.7 |
| 8 | Information disclosure | one office reads another's cases | guards + RLS without bypass, null-safe settings, isolation matrix | 0.9 |
| 9 | Information disclosure | staff browse personal data | sensitive tables encrypted, `reveal()` with reason, masked exports and audit, "who accessed my data", anomaly rules | 0.14, Phase 1–2 |
| 10 | Information disclosure | backup or disk theft | LUKS, encrypted repositories, backups in Ethiopia under a data-processing agreement | 0.26 |
| 11 | Information disclosure | verification page used to harvest data | minimal masked data, random tokens, rate limits, separate host | 0.23 |
| 12 | Denial of service | upload flooding, huge exports, expensive searches | bounded uploads and quotas, async exports, statement timeouts, rate limits | 0.15, 0.16b, 0.16d, 0.16e |
| 13 | Denial of service | ransomware on the main server | pull-mode, append-only off-site backups; restore drills; cold spare | 0.26 |
| 14 | Elevation of privilege | role granted outside one's subtree | delegated admin limited to the subtree and the unit type's role catalogue; access reviews | 0.10, Phase 1 |
| 15 | Elevation of privilege | SSRF from integrations to internal services | egress allowlist proxy, split networks, endpoints only from ops configuration | 0.26 |
| 16 | Elevation of privilege | vulnerable dependency or tampered image | pinned versions, Trivy, Semgrep, SBOM, cosign-verified images | 0.2, releases |
| 17 | Elevation of privilege | vendor support over-reach | "view as user" read-only, time-limited, approved, audited; no hidden super-user | Phase 1 |
| 18 | Information disclosure | a draft's answers left in a shared PC's browser | only classified, non-Sensitive answers kept (unclassified ones stay on the server), sealed with a non-extractable AES-GCM key per person; an explicit sign-out deletes the key and drafts in every tab. Residual risk: the person's separation on one PC is a label in the origin's IndexedDB (code on the origin can read another person's key), and an expired session (no sign-out) leaves the sealed copy by design (SEC-WB-3) | 0.20c |

## Open items
* The per-site network design (VPN or WAN vs. internet exposure of the staff host) depends on each bureau's network. This
  is decided during installation, but is to be documented per region.
* A DPIA per service (PDP 1321/2024), starting with the licence services in Phase 1.
