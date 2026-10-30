# SAFE Security — Product and Domain Context

> Background for building the Security Review feature (see `docs/security-review-plan.md`).
> Compiled from SAFE's public website, press releases and engineering blog, as of late October 2026.
> Product capabilities, agent counts and customer results are SAFE's own claims unless noted.

## Company in brief

- **SAFE** (Safe Security, safe.security), HQ Palo Alto, engineering concentrated in Bengaluru and
  New Delhi. Founded 2012 as Lucideus (IIT Bombay incubated, ethical hacking services); rebranded to
  SAFE in 2021. Roughly 700–750 employees (third-party estimates vary).
- **Funding:** $33M Series A (2021), $50M Series B (2023), $70M Series C led by Avataar Ventures
  (announced July 31, 2025). SAFE reports total funding above $170M.
- **Acquisitions:** RiskLens (July 2023) brought the FAIR risk model and its author Jack Jones;
  Balbix (November 2025) brought CTEM / exposure management.
- **Analyst position:** Leader in the Forrester Wave for Cyber Risk Quantification (Q2 2025), the only
  vendor noted as implementing FAIR-CAM; Leader in the 2026 IDC MarketScape for TPRM and the 2026
  Liminal Index for Cyber TPRM.
- **Buyers:** CISOs, cyber risk officers, TPRM leaders at large enterprises. SAFE says it is used by
  ~10% of the Fortune 500.

## Platform (2026 naming)

**SAFE One** — one platform, "Two AI Co-Workers, 100+ specialized AI agents."

| Component | What it does |
|---|---|
| **SafeX** | Reasoning layer: "24+ SLMs and LLMs, 100+ AI agents, and MCP servers." Ingest → Reason → Act loop over a knowledge graph of business context, attack surface, controls and threat intel. |
| **CRQ** (cyber risk quantification) | FAIR-based: cyber risk in dollars (loss exceedance curves, annualized loss exposure), control prioritization by risk reduction, board reporting. FAIR-CAM measures how well controls actually perform using telemetry. |
| **CTEM AI Co-Worker** | Continuous threat exposure management: scoping, discovery, prioritization, validation, mobilization. Reconciles duplicate assets across tools, prioritizes by active exploitation (CISA KEV and 100+ intel sources), ties exposures to dollar impact, tracks remediation "to verified closure." |
| **TPRM AI Co-Worker** | Third-party risk management: vendor intake, questionnaires, evidence review, contracts, continuous monitoring, offboarding. |
| **AI-SPM** (May 2026) | AI security posture management for enterprise AI use (ChatGPT, Claude, Copilot) via a "Real-Time AI Risk Graph." |
| **Integrations** | 150+ connectors (SAFE says 100+ out of the box), API-based ("agentless"): EDR, IAM, vulnerability management, CSPM, SIEM, ITSM, CAASM, threat intel, contract lifecycle management. |

Agent counts in SAFE's marketing grew over time ("dozens"/"25+" in April 2025, "40+" later in 2025,
"100+" in 2026). Use the current figure and treat it as marketing.

### TPRM agents SAFE names publicly

| Agent | What SAFE says it does | Relevance to this feature |
|---|---|---|
| **Questioneer** | Analyzes questionnaires and auto-maps responses to controls | Our questionnaire answering, mirrored to the vendor side |
| **Evidence Analyzer agents** | Parse SOC 2 and other PDFs, extract control validations, flag discrepancies | Our findings extraction + conflict detection |
| **SnapShot** | AI summaries | Our per-document summary cards |
| **ContractFX / Contract Intelligence** | Flags risky or missing contract clauses (SAFE quotes 45–60 seconds) | Not built |
| **KickstartR** | Extracts structured vendor data from intake forms | Not built |
| **NetProphet** | Collects and monitors public (outside-in) risk signals | Not built |
| **BreachWatch** | Detects third-party breaches | Not built |
| **Shadow Scan** | Finds unknown vendors in the environment | Not built |
| **Fourth-Party Agent** | Uncovers vendors' own vendors | Reason we don't send vendor documents to a third-party parsing API |

SAFE positions this as "inside-out" agentic automation versus "outside-in" security ratings vendors.

## How SAFE says it builds and evaluates agents

From SAFE's engineering blog ("Building Trustworthy AI Agents: A Deep Dive into Measuring Accuracy",
Medium/safe-engineering) and "Why SAFE's AI Is Ahead of the Industry" (July 2025):

- **Predefined output types**, gold standards (ground truths) for every task, and evaluation logic.
- **Metrics:** precision and recall, Top-1 accuracy, and **field accuracy = the percentage of documents
  where a specific field is 100% correct** (used for structured extraction such as contract parsing).
- **Prompts versioned like code:** "every change to a prompt is treated like a code change"; changes are
  versioned, tested, and evaluated for precision and reproducibility.
- **Consistency:** agents are run multiple times to check for consistent output.
- **Structured fields** so humans can "quickly review, validate, and act."
- **Human in the loop:** teams can "review, approve, or override any agent-driven action."
- **User feedback** flows back into evaluations.
- **AURA** (Feb 2026): replaced heavy manual prompt testing with continuous automated evaluation; every
  agent gets an "AI Trust Score" (0–100) covering factors like prompt-injection resistance and
  hallucination avoidance.
- Not public: which LLM vendors SAFE uses, its orchestration framework, numeric human-review thresholds.

**How this feature mirrors it:** gold set written before prompts; field accuracy on extraction; prompt
files versioned (`*.v1.md`) and recorded per run; structured outputs validated with zod; deterministic
checks plus a second-model verifier before anything is marked Ready; human approve/edit/reject with an
append-only audit log; optional repeat runs for consistency.

## Public customer results (vendor-published case studies)

| Customer | Result SAFE reports | Relevance |
|---|---|---|
| Instacart | TPRM design partner; 600+ vendors assessed in 3 weeks; 30+ hours saved per assessment | Scale of questionnaire/evidence review |
| Carvana | Consolidated, normalized and de-duplicated data from multiple scanners; 40% lower breach likelihood, 25% lower premiums | Integration and data-quality work |
| T-Mobile | 75% faster risk reporting; integrations monitoring 1M+ assets | Integration scale |
| Kyriba | 300+ vendors in a week | TPRM throughput |
| San Francisco Health Plan | 90% faster assessments | TPRM throughput |

## Competitive landscape

| Segment | Competitors | SAFE's positioning |
|---|---|---|
| CRQ | Axio, KPMG, Kovrr, X-Analytics | Inside-out telemetry + FAIR/FAIR-CAM authority |
| CTEM | Tenable, XM Cyber, CrowdStrike, Rapid7, Qualys, Axonius | Prioritization in dollars rather than CVSS; many CTEM vendors are also SAFE data sources |
| TPRM | SecurityScorecard, BitSight, Panorays, UpGuard, ProcessUnity, OneTrust | Agentic inside-out assessment vs. external-scan ratings |

## TPRM domain primer (what the feature must get right)

- **TPRM lifecycle:** intake → tiering by risk → due diligence (questionnaires + evidence) → contract
  review → continuous monitoring → offboarding. **Fourth parties** are a vendor's own vendors.
- **Questionnaires:** **SIG** (Shared Assessments Standardized Information Gathering; SIG-Lite is the
  short form) and **CAIQ** (Cloud Security Alliance's Consensus Assessments Initiative Questionnaire).
  Buyers often use their own variants; answers are Yes / No / Partial / N/A plus explanation and evidence.
- **SOC 2:** an AICPA attestation by an independent CPA firm on controls relevant to the Trust Services
  Criteria (Security is required; Availability, Confidentiality, Processing Integrity, Privacy optional).
  - **Type I** = design at a point in time; **Type II** = design *and* operating effectiveness over a
    period (usually 6–12 months). Buyers want Type II.
  - Structure: auditor's opinion, management's assertion, system description, then controls with the
    auditor's tests and results. **Exceptions** are listed per control; management may respond.
  - A **qualified** opinion is serious; exceptions with an unqualified opinion are common but must be
    disclosed and remediated.
  - **Subservice organizations** (e.g. AWS) are either *carved out* (their controls excluded — the buyer
    must get the subservice org's own report) or *inclusive*.
  - **CUECs** (complementary user entity controls) are things the customer must do for the vendor's
    controls to work.
  - **Bridge letter:** a vendor statement covering the gap between the report period end and today.
- **Pen test summary:** scope, methodology (e.g. OWASP WSTG, PTES), findings with severity and status,
  retest results. Open critical/high findings matter most.
- **Policy vs. evidence:** a policy says what should happen; SOC 2 tests, pen tests and metrics show what
  did happen. When they disagree, that is a finding, not something to smooth over in an answer.
- **Frameworks:** NIST CSF 2.0, ISO 27001, CIS Controls, SOC 2. **NIS2** and **DORA** (EU; DORA applies
  to financial-sector ICT third-party risk since January 2025) drive TPRM demand in Europe.

## Security terms used in the sample data

- **MFA** multi-factor authentication · **EDR** endpoint detection and response · **SIEM** central log
  analytics · **PAM** privileged access management · **IdP** identity provider.
- **CVE / CVSS / EPSS / CISA KEV:** vulnerability ID / severity score / probability of exploitation in
  30 days / catalog of vulnerabilities known to be actively exploited. Risk-based prioritization combines
  them with asset criticality.
- **RTO / RPO:** recovery time objective / recovery point objective.
- **FAIR:** Factor Analysis of Information Risk; risk = loss event frequency × loss magnitude, as ranges
  run through Monte Carlo simulation.

## Sources

- SAFE One product overview — https://safe.security/product-overview/
- SafeX — https://safe.security/safex/
- TPRM — https://safe.security/third-party-risk-management/
- CTEM — https://safe.security/continuous-threat-exposure-management/
- Integrations — https://safe.security/integrations/
- TPRM agents blog — https://safe.security/resources/blog/safe-super-ai-agents-third-party-risk-management/
- "Why SAFE's AI Is Ahead of the Industry" — https://safe.security/resources/blog/why-safes-ai-is-ahead-of-the-industry/
- "Building Trustworthy AI Agents: A Deep Dive into Measuring Accuracy" — https://medium.com/safe-engineering/building-trustworthy-ai-agents-a-deep-dive-into-measuring-accuracy-8f33ce41b2a2
- AURA framework — https://safe.security/resources/blog/the-credit-score-for-ai-introducing-the-aura-framework/
- Series C release (July 31, 2025) — https://www.prnewswire.com/news-releases/safe-raises-70-million-series-c-to-build-cyberagi-unveils-worlds-first-fully-autonomous-ctem-solution-302518057.html
- Balbix acquisition — https://safe.security/resources/press-release/safe-acquires-balbix-press-release/
- Instacart — https://safe.security/resources/customer-stories/instacart-designing-tprm-and-delivering-risk-singularity/
- Carvana — https://safe.security/resources/customer-stories/carvana-driving-cyber-resilience-up-insurance-down/
- T-Mobile — https://safe.security/resources/customer-stories/t-mobile-cutting-the-cord-on-subjective-risk-scores/
- Forrester Wave CRQ — https://safe.security/resources/analyst-reports/forrester-wave-crq/
