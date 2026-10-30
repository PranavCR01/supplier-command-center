# Security review sample data (synthetic)

Evidence for the vendor-side security review demo. Everything here is fictional and every page
is footed **SYNTHETIC - FOR DEMONSTRATION ONLY**. The auditor (Halvorsen & Pike LLP) and pen
test firm (Redline Assurance Group) are made up; no real firm's name is attached to an opinion.

- Vendor: Acme Tech Solutions Inc. (same as `test_data/suppliers/acme_tech_solutions.json`)
- Buyer: Clearfield Financial (same as the onboarding request in `test_data/buyer-requests/`)

## Files (`documents/`)

| File | Type | Pages / rows |
|---|---|---|
| `acme_soc2_type2_2026.pdf` | SOC 2 Type II, period Jul 1 2025 - Jun 30 2026 | 16 pages, 21 controls |
| `acme_pentest_summary_2026.pdf` | External and web app pen test summary, Aug 2026, retest Oct 5 2026 | 4 pages, 7 findings |
| `acme_phishing_simulation_summary_2026.pdf` | Phishing and awareness summary, Oct 2025 - Sep 2026 | 3 pages |
| `acme_infosec_access_control_policy_v3.2.pdf` | Information Security and Access Control Policy v3.2 | 6 pages |
| `acme_access_review_q2_2026.xlsx` | Q2 2026 user access review export (evidence) | 31 accounts + summary |
| `clearfield_vendor_security_questionnaire.xlsx` | Buyer questionnaire, SIG-Lite style (input) | 22 questions |

## What is planted

**Conflicts between documents** (must route to Conflict, never auto-resolve):

| Question | Document A | Document B |
|---|---|---|
| IAM-01 | Policy p.3: MFA enforced for all interactive access, including administrative interfaces | Pen test PT-03: admin portal accepts password-only login |
| VULN-02 | Policy p.4: critical vulnerabilities remediated within 15 days | Pen test PT-01: critical finding open 45 days |
| TRN-02 | Policy p.5: quarterly phishing simulations | Phishing summary p.1: two campaigns in 12 months |
| TRN-01 | Policy p.5: all personnel train annually | Phishing summary p.1: 87% completion (Conflict or Needs Evidence both acceptable) |

**Decoys** (must *not* be flagged as conflicts): IAM-02 (VPN/console MFA is genuinely enforced),
IAM-04 (policy and SOC 2 agree on quarterly reviews; the issue is an auditor exception), DATA-01.

**Auditor exceptions**: CC6.2 access review (2 of 25 removed 41 days late, corroborated by rows
27-28 of the access review export) and CC8.1 emergency change approved 3 business days late.

**Carve-out**: data center physical security is AWS's responsibility (SOC 2 p.7), so DATA-05 needs
the AWS SOC 2 report.

**Not answerable from any document**: DATA-04 (client data destruction within 30 days; the
retention clause covers Acme's own business records only) and BCP-02 (no RTO/RPO values anywhere).

**Wording trap**: IAM-03 asks for 24 hours; the evidence says one business day.

Expected outcome: 12 Ready, 6 Needs Evidence, 4 Conflict. Full labels in `gold.json`.

## Regenerating

```bash
py -3.14 scripts/tprm/generate_samples.py      # Windows
python3 scripts/tprm/generate_samples.py       # macOS/Linux
npm run tprm:verify-samples                    # confirms every gold anchor is still on its gold page
```

`gold.json` was written before any prompt existed. If you change the documents, re-run the
verifier; do not edit gold labels to match model output.
