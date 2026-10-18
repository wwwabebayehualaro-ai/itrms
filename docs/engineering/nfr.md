# Non-functional requirements (one table)

The targets ITRMS commits to, collected from the architecture, ADRs and phase plans. Each one has a measurement and the task
that proves it. Contract values (availability, RPO/RTO) are proposals to agree with each customer.

| Area | Requirement | Target | How it is measured | Proven in |
|---|---|---|---|---|
| Availability | Staff application during working hours | ≥ 99.5 % per month (excluding announced maintenance windows) | uptime probes (Alloy/Prometheus) | Phase 1 pilot |
| Recovery | RPO (data loss) | ≤ 15 minutes | WAL archive lag alert; restore drill | 0.26, monthly drill |
| Recovery | RTO (time to restore) | ≤ 8 hours (cold spare on site) | restore drill timing | 0.26, Phase 1 |
| Performance | Reads (lists, record pages) | p95 < 300 ms at regional load | k6 + OpenTelemetry | 0.16, 0.26 |
| Performance | Commands (submit, transition, payment) | p95 < 800 ms | k6 | 0.19, 0.22, 0.26 |
| Performance | Name/registry search over 10⁶ persons | < 300 ms, index used under RLS | EXPLAIN + timing test | 0.14 |
| Performance | PDF generation | < 5 s per document at p95; never in the request | job metrics | 0.23 |
| Web | JS per case screen | ≤ 250 KB compressed | CI bundle check | 0.4a onwards |
| Web | Largest Contentful Paint on a 3G-class link | ≤ 3 s for the shell; ≤ 4 s for a case page | real-user web vitals per office | Phase 1 |
| Capacity | Regional load | ~10⁶ cases/year, a few hundred concurrent staff, on 8 vCPU / 48 GB / SSD | k6 at 3× expected load | 0.26, 3.13 |
| Resilience | Network drops at offices | no lost draft, no duplicate command | PWA queue + idempotency tests | 0.11, 0.20 |
| Security | Application verification level | OWASP ASVS 4 L2 (L3 for auth, sessions, money, audit) | checklist + pentest | Phase 1 (INSA) |
| Security | Tenant isolation | 100 % of tenant tables in the isolation matrix | CI matrix | 0.9 onwards |
| Security | Vulnerabilities | no open high/critical findings at release | Trivy, Semgrep, pentest | every release |
| Privacy | PDP 1321/2024 duties | sensitive fields encrypted, masked, reveals audited; breach runbook; DPIA per service | tests + documents | 0.14, Phase 1 |
| Integrity | Audit | append-only, hash chain verifies, daily digest off-site | restore drill verifies the chain | 0.7, 0.26 |
| Integrity | Receipts | gapless per unit and fiscal year under concurrency | concurrency test | 0.11, 0.22 |
| Accessibility | WCAG | 2.2 AA; no axe violations | axe in e2e and Storybook | 0.4a onwards |
| Localisation | Languages | `am`, `en` complete; `wal-Latn` with fallback | i18n check | 0.13 onwards |
| Time | Clock accuracy | drift < 1 s | chrony + alert | 0.26 |
| Maintainability | Upgrades | one-command upgrade from the previous release, tested in CI | upgrade test | from first release |
| Support | Diagnosability | every error has a request/trace id shown to the user | e2e check | 0.6 |
