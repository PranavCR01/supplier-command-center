Task: classify the document above and extract its findings as structured records.

## 1. doc_type

Pick exactly one:
- `soc2_report` — an auditor's SOC 2 report (opinion, system description, controls with test results)
- `pentest_summary` — a penetration test report or summary (scope, findings with severity and status)
- `phishing_summary` — security awareness / phishing simulation results
- `security_policy` — a policy or standard stating what the organization requires
- `access_review` — a user access review export or log (accounts, reviewer decisions, removal dates)
- `other` — anything else

Give a one-sentence `doc_type_reason` naming the feature of the document that decided it.

## 2. findings

Extract records according to the document type. Use only these kinds.

**soc2_report**
- `control`: one record for every control in the auditor's tests of controls. `ref` = control ID
  exactly as written (e.g. "CC6.2"). `title` = the control description, shortened if needed.
  `status` = `exceptions_noted` only if the auditor's test result records an exception for that
  control; otherwise `no_exceptions`. A management response is not an exception.
  Quote the control's test result or description from the page where the control appears.
- `control_exception`: one additional record for each control with an exception. `ref` = control ID.
  `detail` = what the auditor found, with the numbers as written. Quote the exception text.
- `carve_out`: one record per subservice organization whose controls are excluded (carved out).
  `title` = the subservice organization's name (e.g. "AWS"). `detail` = what it is responsible for.
- `stated_severity` is null for all SOC 2 records: SOC 2 reports do not rate severity.

**pentest_summary**
- `pentest_finding`: one record per finding. `ref` = finding ID as written (e.g. "PT-03").
  `stated_severity` = the severity word exactly as the report states it (e.g. "High"). Never assign
  or adjust a severity yourself; if the report states none, use null.
  `status` = `open`, `remediated`, or `risk_accepted`, using the most recent status the report gives
  (e.g. a retest result). Quote the finding's row or paragraph.

**phishing_summary**
- `phishing_metric` records, with `detail` = the value exactly as written (e.g. "87%", "2"):
  - `ref` = `campaign_count`: number of simulation campaigns conducted in the reporting period.
  - `ref` = `click_rate`: one per campaign; `title` must include the campaign month and year.
  - `ref` = `report_rate`: one per campaign, if stated; `title` includes the campaign month and year.
  - `ref` = `training_completion`: share of personnel who completed awareness training.

**security_policy**
- `policy_statement`: up to 20 of the most specific, testable commitments (timeframes, frequencies,
  scopes, e.g. "Critical vulnerabilities are remediated within 15 calendar days"). `ref` = the policy
  section number if shown, else null. `title` = the commitment in a few words.

**access_review**
- `access_review_exception`: one record per account whose review outcome was not carried out on
  time or as decided (e.g. removed later than the stated deadline). `ref` = "Row N". `title` = the
  account name and what went wrong. `detail` = the dates or day counts as written. Cite the sheet and
  row of that account. Accounts handled correctly are not exceptions.

**other**: return an empty findings list.

For every record, `location` points at where the `quote` appears, and `status`/`stated_severity`
are null unless the rules above give them a value.
