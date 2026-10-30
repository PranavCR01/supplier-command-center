-- Optional: add the Clearfield security questionnaire message (req_006) to an existing demo account.
-- New accounts get it from "Load demo data". Replace the email, then run in the Supabase SQL editor.
-- Touches only that supplier's inbox. Expect: "Success. 1 row inserted" (0 if already present).

INSERT INTO inbox_requests (supplier_id, type, priority, from_buyer, from_contact, from_email, from_platform,
                            subject, body, deadline, received_at, status, tags, attachments)
SELECT s.id, 'compliance', 'high', 'Clearfield Financial',
       'Priya Anand', 'p.anand@clearfieldfinancial.com', 'Email / Manual',
       'Vendor Security Questionnaire (SIG-Lite) — Response Needed by November 13',
       'Hi Acme Tech Solutions team,

As the last step before final vendor approval, our Third-Party Risk team needs your responses to the attached Vendor Security Questionnaire (SIG-Lite style, 22 questions). It replaces the earlier 47-question PDF.

For each question, please answer Yes, No, Partial, or N/A, add a short explanation, and reference the supporting evidence (document name and page). We will review the evidence alongside your answers, so please include:

- Your most recent SOC 2 Type II report
- Your latest external penetration test summary, including retest status
- Security awareness and phishing simulation results for the last 12 months
- Your information security / access control policy
- Your most recent user access review

Where your evidence shows an exception or an open finding, please tell us and include your remediation plan and target dates. Incomplete questionnaires will be returned.

Please send everything by November 13, 2026.

Thank you,
Priya Anand
Procurement Manager
Clearfield Financial',
       '2026-11-13', '2026-10-27T15:30:00Z', 'pending_response', ARRAY['security-review', 'sig-lite', 'soc2', 'third-party-risk'], ARRAY['clearfield_vendor_security_questionnaire.xlsx']
FROM suppliers s
JOIN auth.users u ON u.id = s.user_id
WHERE u.email = 'YOUR_LOGIN_EMAIL'
  AND NOT EXISTS (
    SELECT 1 FROM inbox_requests r WHERE r.supplier_id = s.id AND r.subject = 'Vendor Security Questionnaire (SIG-Lite) — Response Needed by November 13'
  );
