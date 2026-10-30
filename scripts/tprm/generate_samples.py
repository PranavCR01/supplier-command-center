"""Generate synthetic security evidence for the vendor-side security review demo.

Fictional vendor: Acme Tech Solutions Inc. (matches test_data/suppliers/acme_tech_solutions.json)
Fictional buyer:  Clearfield Financial (matches test_data/buyer-requests/inbox_messages.json)
Fictional firms:  Halvorsen & Pike LLP (auditor), Redline Assurance Group (pen test)

Every page is footed "SYNTHETIC - FOR DEMONSTRATION ONLY". Page breaks are explicit so the
page numbers referenced in test_data/tprm/gold.json stay stable. After regenerating, run
`npm run tprm:verify-samples` to confirm every gold anchor is still on its gold page.

Usage (Windows):  py -3.14 scripts/tprm/generate_samples.py
Usage (other):    python3 scripts/tprm/generate_samples.py
Requires: reportlab, openpyxl
"""

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = Path(__file__).resolve().parents[2] / "test_data" / "tprm" / "documents"
FOOTER = "SYNTHETIC - FOR DEMONSTRATION ONLY - Acme Tech Solutions Inc."

styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=16, spaceAfter=10)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12.5, spaceBefore=8, spaceAfter=6)
BODY = ParagraphStyle("Body", parent=styles["BodyText"], fontSize=9.5, leading=13, spaceAfter=6)
CELL = ParagraphStyle("Cell", parent=BODY, fontSize=8.5, leading=11, spaceAfter=0)
TITLE = ParagraphStyle("Title", parent=H1, fontSize=22, leading=28, alignment=TA_CENTER, spaceAfter=16)
SUB = ParagraphStyle("Sub", parent=BODY, fontSize=11, leading=15, alignment=TA_CENTER)


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(0.75 * inch, 0.5 * inch, FOOTER)
    canvas.drawRightString(7.75 * inch, 0.5 * inch, f"Page {doc.page}")
    canvas.restoreState()


def build_pdf(filename: str, pages: list[list]):
    """pages: list of flowable lists; a PageBreak is inserted between pages."""
    story = []
    for i, page in enumerate(pages):
        if i > 0:
            story.append(PageBreak())
        story.extend(page)
    doc = SimpleDocTemplate(
        str(OUT / filename), pagesize=LETTER,
        leftMargin=0.75 * inch, rightMargin=0.75 * inch, topMargin=0.75 * inch, bottomMargin=0.85 * inch,
        title=filename, author="Synthetic data generator",
    )
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return len(pages)


def p(text: str, style=BODY):
    return Paragraph(text, style)


def table(rows: list[list[str]], widths: list[float], header=True):
    data = [[Paragraph(c, CELL) for c in r] for r in rows]
    t = Table(data, colWidths=[w * inch for w in widths], repeatRows=1 if header else 0)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E2E8F0")))
    t.setStyle(TableStyle(style))
    return t


# =============================================================================
# 1. SOC 2 Type II report
# =============================================================================

SOC2_CONTROL_HEADER = ["Control ID", "Control Activity", "Tests Performed by Service Auditor", "Results of Tests"]
W4 = [0.7, 2.1, 2.5, 1.7]

SOC2_CONTROLS_BY_PAGE = [
    # page 9: control environment / communication
    ("CC1 - CC2: Control Environment and Communication", [
        ["CC1.1", "Acme maintains a code of conduct that all employees acknowledge upon hire and annually.",
         "Inspected acknowledgements for a sample of 25 employees.", "No exceptions noted."],
        ["CC1.4", "Background checks are performed for new hires prior to their start date.",
         "Inspected background check results for a sample of 25 new hires.", "No exceptions noted."],
        ["CC2.2", "Employees complete security awareness training upon hire and annually thereafter. Completion is tracked by the Information Security team.",
         "Inspected training completion records for a sample of 25 employees active during the period.", "No exceptions noted."],
        ["CC2.3", "Acme communicates security commitments to customers through master services agreements and the customer security addendum.",
         "Inspected the customer security addendum and a sample of 5 executed agreements.", "No exceptions noted."],
    ]),
    # page 10: risk assessment / monitoring / policy
    ("CC3 - CC5: Risk Assessment, Monitoring and Control Activities", [
        ["CC3.1", "An enterprise risk assessment is performed annually and reviewed by executive management.",
         "Inspected the risk assessment dated February 9, 2026 and evidence of executive review.", "No exceptions noted."],
        ["CC4.2", "An independent third party performs an external penetration test at least annually. Findings are tracked to remediation in the ticketing system.",
         "Inspected the penetration test report dated September 12, 2025 and remediation tickets for findings rated high or critical.", "No exceptions noted."],
        ["CC5.3", "Information security policies are reviewed and approved by management at least annually and published to employees.",
         "Inspected the Information Security and Access Control Policy approval dated January 15, 2026.", "No exceptions noted."],
    ]),
    # page 11: logical access I
    ("CC6: Logical and Physical Access Controls (1 of 2)", [
        ["CC6.1", "Multi-factor authentication is required for remote access to the production network via VPN and for access to the AWS management console.",
         "Inspected VPN and AWS IAM Identity Center configurations and observed a login attempt without a second factor being denied.", "No exceptions noted."],
        ["CC6.2", "User access to production systems and the identity provider is reviewed quarterly by system owners. Access identified as inappropriate is removed within 10 business days of review sign-off.",
         "Inspected the quarterly access reviews performed during the period. For the Q2 2026 review, inspected a sample of 25 accounts marked for removal or retention.",
         "Exception noted. For the Q2 2026 access review, 2 of 25 sampled accounts marked for removal were not removed until 41 days after review sign-off."],
        ["CC6.3", "Access for terminated personnel is removed within one business day of the termination date.",
         "Inspected HR termination records and access removal tickets for a sample of 15 terminations.", "No exceptions noted."],
    ]),
    # page 12: logical access II
    ("CC6: Logical and Physical Access Controls (2 of 2)", [
        ["CC6.4", "Privileged access to production is restricted to authorized personnel using separate administrative accounts.",
         "Inspected the listing of privileged accounts and compared it to authorized personnel; confirmed administrative accounts are distinct from standard user accounts.", "No exceptions noted."],
        ["CC6.6", "Network traffic to production is restricted by security groups and a web application firewall.",
         "Inspected security group rules and WAF configuration for production.", "No exceptions noted."],
        ["CC6.7", "Customer data at rest is encrypted using AES-256 through AWS Key Management Service. Data in transit is encrypted using TLS 1.2 or higher.",
         "Inspected storage encryption settings for production databases and object storage, and TLS configurations for public endpoints.", "No exceptions noted."],
        ["CC6.8", "Endpoint detection and response software is deployed to all company endpoints and production servers, and alerts are monitored by the security team.",
         "Inspected the EDR console asset listing and compared it to the asset inventory for a sample of 25 assets.", "No exceptions noted."],
    ]),
    # page 13: operations
    ("CC7: System Operations", [
        ["CC7.1", "Authenticated vulnerability scans of the production environment are performed monthly. Critical and high findings are tracked in the ticketing system.",
         "Inspected scan reports for a sample of 4 months and the related tickets.", "No exceptions noted."],
        ["CC7.2", "Security events from production systems are centralized in a SIEM and alerts are reviewed by the security team.",
         "Inspected SIEM log source configuration and a sample of 25 alerts with evidence of review.", "No exceptions noted."],
        ["CC7.4", "A documented incident response plan is reviewed annually and tested through an annual tabletop exercise.",
         "Inspected the incident response plan and the tabletop exercise report dated March 12, 2026.", "No exceptions noted."],
    ]),
    # page 14: change management / vendors
    ("CC8 - CC9: Change Management and Risk Mitigation", [
        ["CC8.1", "Changes to production are documented, tested, and approved prior to deployment. Emergency changes are approved within one business day after deployment.",
         "Inspected a sample of 25 production changes, including emergency changes, for evidence of testing and approval.",
         "Exception noted. 1 of 25 sampled changes was an emergency change that was approved 3 business days after deployment to production."],
        ["CC9.2", "Vendors with access to customer data are assessed at onboarding and annually thereafter.",
         "Inspected vendor assessments for a sample of 5 vendors.", "No exceptions noted."],
    ]),
    # page 15: availability
    ("A1: Availability", [
        ["A1.2", "Production databases are backed up daily and replicated to a secondary AWS region. Restore tests are performed quarterly.",
         "Inspected backup configuration and restore test evidence for a sample of 2 quarters.", "No exceptions noted."],
        ["A1.3", "A business continuity and disaster recovery plan is documented and tested annually.",
         "Inspected the disaster recovery test report dated May 20, 2026.", "No exceptions noted."],
    ]),
]


def soc2():
    pages = []
    # 1 cover
    pages.append([
        Spacer(1, 1.6 * inch),
        p("Acme Tech Solutions Inc.", TITLE),
        p("Report on Controls at a Service Organization Relevant to Security and Availability", SUB),
        p("SOC 2 Type II", SUB),
        Spacer(1, 0.3 * inch),
        p("Managed IT Services Platform", SUB),
        p("For the period July 1, 2025 to June 30, 2026", SUB),
        Spacer(1, 1.2 * inch),
        p("Independent Service Auditor: Halvorsen &amp; Pike LLP", SUB),
        p("CONFIDENTIAL - Intended solely for the information and use of Acme Tech Solutions Inc., its user entities, and prospective user entities.", SUB),
    ])
    # 2 contents
    pages.append([
        p("Table of Contents", H1),
        table([
            ["Section", "Title", "Page"],
            ["I", "Independent Service Auditor's Report", "3"],
            ["II", "Management's Assertion", "5"],
            ["III", "Description of the Managed IT Services Platform", "6"],
            ["IV", "Trust Services Criteria, Controls, Tests and Results", "9"],
            ["V", "Other Information Provided by Management (unaudited)", "16"],
        ], [0.8, 4.8, 0.8]),
    ])
    # 3-4 opinion
    pages.append([
        p("Section I - Independent Service Auditor's Report", H1),
        p("To the Management of Acme Tech Solutions Inc.:", BODY),
        p("Scope", H2),
        p("We have examined Acme Tech Solutions Inc.'s (Acme) accompanying description of its Managed IT Services Platform "
          "titled \"Description of the Managed IT Services Platform\" throughout the period July 1, 2025 to June 30, 2026 "
          "(the description) and the suitability of the design and operating effectiveness of controls stated in the description "
          "to provide reasonable assurance that Acme's service commitments and system requirements were achieved based on the "
          "trust services criteria relevant to security and availability."),
        p("Acme uses Amazon Web Services (AWS) as a subservice organization to provide infrastructure hosting, including physical "
          "security and environmental safeguards of data centers. The description includes only the controls of Acme and excludes "
          "controls of AWS. Our examination did not extend to controls of AWS."),
        p("Service Organization's Responsibilities", H2),
        p("Acme is responsible for its service commitments and system requirements and for designing, implementing, and operating "
          "effective controls within the system to provide reasonable assurance that those commitments and requirements were achieved."),
        p("Service Auditor's Responsibilities", H2),
        p("Our responsibility is to express an opinion on the description and on the suitability of the design and operating "
          "effectiveness of controls stated in the description based on our examination. Our examination was conducted in accordance "
          "with attestation standards established by the American Institute of Certified Public Accountants."),
    ])
    pages.append([
        p("Section I - Independent Service Auditor's Report (continued)", H1),
        p("Description of Tests of Controls", H2),
        p("The specific controls we tested and the nature, timing, and results of those tests are presented in Section IV of this report."),
        p("Exceptions Noted", H2),
        p("Section IV describes two exceptions identified in our tests of operating effectiveness, relating to criterion CC6.2 "
          "(quarterly user access reviews) and criterion CC8.1 (change management). These exceptions did not, in our judgment, "
          "result in a failure to achieve the related service commitments and system requirements."),
        p("Opinion", H2),
        p("In our opinion, in all material respects, the description presents the Managed IT Services Platform that was designed and "
          "implemented throughout the period July 1, 2025 to June 30, 2026, and the controls stated in the description operated "
          "effectively throughout that period to provide reasonable assurance that Acme's service commitments and system requirements "
          "were achieved based on the applicable trust services criteria."),
        Spacer(1, 0.3 * inch),
        p("Halvorsen &amp; Pike LLP"),
        p("Austin, Texas"),
        p("August 28, 2026"),
    ])
    # 5 management assertion
    pages.append([
        p("Section II - Management's Assertion", H1),
        p("We have prepared the accompanying description of Acme Tech Solutions Inc.'s Managed IT Services Platform throughout the period "
          "July 1, 2025 to June 30, 2026. We confirm, to the best of our knowledge and belief, that the description presents the system "
          "that was designed and implemented throughout the period, and that the controls stated in the description were suitably "
          "designed and operated effectively throughout the period, except for the matters described in Section IV."),
        Spacer(1, 0.2 * inch),
        p("Robert Hale, Chief Executive Officer"),
        p("Daniel Ortiz, Director of Information Security"),
        p("Acme Tech Solutions Inc."),
    ])
    # 6 system description
    pages.append([
        p("Section III - Description of the Managed IT Services Platform", H1),
        p("Company Overview", H2),
        p("Acme Tech Solutions Inc. is headquartered in Austin, Texas and provides managed IT services, help desk support, cloud "
          "infrastructure management, and cybersecurity services to mid-market and enterprise customers."),
        p("Infrastructure", H2),
        p("The Managed IT Services Platform is hosted on Amazon Web Services. Customer data is stored in the AWS us-east-1 (N. Virginia) "
          "region, with backups replicated to the AWS us-east-2 (Ohio) region. Acme does not operate its own data centers."),
        p("Software and People", H2),
        p("The platform consists of a customer portal, an internal administrative portal used by Acme service staff, a ticketing system, "
          "and remote monitoring and management tooling. The Information Security team, led by the Director of Information Security, "
          "is responsible for security operations, vulnerability management, and security awareness."),
    ])
    # 7 subservice / CUECs
    pages.append([
        p("Section III - Description (continued)", H1),
        p("Subservice Organizations", H2),
        p("Acme uses AWS as a subservice organization for infrastructure hosting. Physical security and environmental safeguards of the "
          "data centers hosting customer data are the responsibility of AWS and are excluded from the scope of this report (carved-out "
          "method). User entities should obtain and review the AWS SOC 2 report to evaluate those controls."),
        p("Complementary User Entity Controls", H2),
        p("Acme's controls were designed with the assumption that user entities will: (1) promptly notify Acme of changes to authorized "
          "user contacts; (2) manage the access of their own personnel to the customer portal; (3) report suspected security incidents "
          "to Acme without delay."),
    ])
    # 8 control environment narrative
    pages.append([
        p("Section III - Description (continued)", H1),
        p("Control Environment and Risk Assessment", H2),
        p("Acme's executive management sets the tone for the organization's commitment to security. Information security policies are "
          "approved annually. An annual enterprise risk assessment identifies risks to service commitments and assigns owners."),
        p("Information and Communication", H2),
        p("Security policies are published on the company intranet. Employees complete security awareness training upon hire and annually. "
          "Security commitments are communicated to customers through contracts and the customer security addendum."),
    ])
    # 9-15 controls
    for title, rows in SOC2_CONTROLS_BY_PAGE:
        pages.append([
            p("Section IV - Trust Services Criteria, Controls, Tests and Results", H1),
            p(title, H2),
            table([SOC2_CONTROL_HEADER] + rows, W4),
        ])
    # 16 management responses
    pages.append([
        p("Section V - Other Information Provided by Management (unaudited)", H1),
        p("The information in this section is presented by management and was not subject to the procedures applied in the examination."),
        p("Management Response to CC6.2 Exception", H2),
        p("The two accounts were contractor accounts whose removal tickets were assigned to a departed team member. Management has "
          "implemented automated removal for accounts marked for removal in the access review tool, effective August 2026."),
        p("Management Response to CC8.1 Exception", H2),
        p("The emergency change was a production hotfix deployed during a holiday weekend. Management has added an automated reminder "
          "for retrospective approval of emergency changes."),
    ])
    return build_pdf("acme_soc2_type2_2026.pdf", pages)


# =============================================================================
# 2. Penetration test summary
# =============================================================================

def pentest():
    pages = []
    pages.append([
        p("External and Web Application Penetration Test", H1),
        p("Executive Summary Report - Acme Tech Solutions Inc."),
        p("Prepared by Redline Assurance Group. Testing window: August 10 to August 21, 2026. Report issued: September 4, 2026. "
          "Retest status updated: October 5, 2026."),
        p("Scope", H2),
        table([
            ["Target", "Type"],
            ["portal.acmetechsolutions.com (customer portal)", "Authenticated web application"],
            ["admin.acmetechsolutions.com (administrative portal)", "Authenticated web application"],
            ["vpn.acmetechsolutions.com (remote access VPN)", "External network service"],
            ["Acme external IP ranges (2 x /27)", "External network"],
        ], [4.2, 2.8]),
        p("Methodology", H2),
        p("Testing followed a gray-box approach aligned to the OWASP Web Security Testing Guide and the PTES technical guidelines. "
          "Findings are rated Critical, High, Medium, or Low based on exploitability and business impact."),
    ])
    pages.append([
        p("Summary of Findings", H1),
        p("Redline identified 1 critical, 2 high, 2 medium, and 2 low severity findings. As of the October 5, 2026 retest, "
          "the critical finding and one high finding remain open."),
        table([
            ["ID", "Title", "Severity", "Status (Oct 5, 2026)"],
            ["PT-01", "VPN appliance firmware vulnerable to a publicly known, actively exploited remote code execution vulnerability", "Critical", "Open"],
            ["PT-02", "Stored cross-site scripting in customer portal ticket comments", "High", "Remediated - verified in retest"],
            ["PT-03", "Administrative portal accepts password-only authentication without MFA", "High", "Open"],
            ["PT-04", "Verbose error messages disclose framework version", "Medium", "Remediated - verified in retest"],
            ["PT-05", "Session timeout of 24 hours on the customer portal", "Medium", "Open"],
            ["PT-06", "Missing HTTP security headers on marketing site", "Low", "Open"],
            ["PT-07", "TLS 1.0 enabled on a legacy SMTP relay", "Low", "Remediated - verified in retest"],
        ], [0.6, 3.6, 0.9, 1.9]),
    ])
    pages.append([
        p("Detailed Findings - Critical and High", H1),
        p("PT-01 - VPN appliance firmware vulnerable to remote code execution (Critical)", H2),
        p("The remote access VPN appliance runs firmware affected by a publicly known remote code execution vulnerability that is listed "
          "in the CISA Known Exploited Vulnerabilities catalog. An unauthenticated attacker could execute code on the appliance. "
          "The finding was reported to Acme on August 21, 2026. As of the October 5, 2026 retest, the firmware had not been updated "
          "and the finding remains open, 45 days after it was reported. Acme indicated the upgrade is scheduled for a maintenance window."),
        p("PT-02 - Stored cross-site scripting in customer portal (High)", H2),
        p("Ticket comments in the customer portal did not encode user-supplied input. Remediated by Acme on September 2, 2026 and "
          "verified during the retest."),
        p("PT-03 - Administrative portal without multi-factor authentication (High)", H2),
        p("The administrative portal at admin.acmetechsolutions.com accepts a username and password without requiring multi-factor "
          "authentication. The portal is reachable from the internet and grants Acme staff access to customer tenant configuration. "
          "Acme stated that MFA enforcement for the administrative portal is planned for Q4 2026. The finding remains open as of the retest."),
    ])
    pages.append([
        p("Detailed Findings - Medium and Low", H1),
        p("PT-04 through PT-07 are summarized in the findings table. Medium and low findings do not present a direct path to "
          "customer data and are recommended for remediation within normal maintenance cycles."),
        p("Recommendations", H2),
        p("1. Upgrade the VPN appliance firmware immediately and review appliance logs for indicators of compromise. "
          "2. Enforce multi-factor authentication on the administrative portal through the corporate identity provider. "
          "3. Reduce the customer portal session timeout to 8 hours or less."),
        p("Attestation", H2),
        p("Redline Assurance Group performed this assessment independently. This summary is provided for Acme's customers and "
          "prospective customers and does not include exploit details."),
    ])
    return build_pdf("acme_pentest_summary_2026.pdf", pages)


# =============================================================================
# 3. Phishing simulation and awareness summary
# =============================================================================

def phishing():
    pages = []
    pages.append([
        p("Security Awareness and Phishing Simulation Summary", H1),
        p("Acme Tech Solutions Inc. - Information Security team. Reporting period: October 1, 2025 to September 30, 2026."),
        p("Summary", H2),
        p("Two phishing simulation campaigns were conducted during the reporting period, in February 2026 and August 2026. "
          "A third campaign planned for May 2026 was cancelled during the migration to a new simulation platform."),
        p("The click rate fell from 19% in the February campaign to 14% in the August campaign. The share of employees who reported "
          "the simulated phish rose from 22% to 31%."),
        p("As of September 30, 2026, 124 of 142 employees (87%) had completed the FY2026 annual security awareness training module. "
          "The remaining 18 employees were sent escalation notices with a completion deadline of October 31, 2026."),
    ])
    pages.append([
        p("Campaign Details", H1),
        table([
            ["Campaign", "Date", "Recipients", "Clicked", "Click rate", "Reported", "Report rate"],
            ["Invoice lure", "February 17, 2026", "138", "26", "19%", "30", "22%"],
            ["Shared document lure", "August 11, 2026", "142", "20", "14%", "44", "31%"],
        ], [1.3, 1.25, 0.85, 0.7, 0.8, 0.8, 0.8]),
        p("Employees who clicked in both campaigns (7 employees) were assigned a 20-minute remedial training module."),
    ])
    pages.append([
        p("Next Steps", H1),
        p("1. Resume a quarterly simulation cadence beginning in FY2027 on the new platform. "
          "2. Reach 100% completion of annual training by October 31, 2026. "
          "3. Add a phishing report button to the mobile mail client."),
        p("Prepared by Daniel Ortiz, Director of Information Security."),
    ])
    return build_pdf("acme_phishing_simulation_summary_2026.pdf", pages)


# =============================================================================
# 4. Information Security and Access Control Policy
# =============================================================================

def policy():
    pages = []
    pages.append([
        p("Information Security and Access Control Policy", H1),
        p("Acme Tech Solutions Inc."),
        table([
            ["Field", "Value"],
            ["Version", "3.2"],
            ["Effective date", "January 15, 2026"],
            ["Policy owner", "Daniel Ortiz, Director of Information Security"],
            ["Approved by", "Robert Hale, Chief Executive Officer"],
            ["Review cycle", "Reviewed and approved at least annually"],
        ], [1.8, 4.6]),
        p("1. Purpose and Scope", H2),
        p("This policy defines the security requirements for protecting Acme and customer information. It applies to all employees, "
          "contractors, and systems that store, process, or transmit Acme or customer data."),
    ])
    pages.append([
        p("2. Roles and Responsibilities", H2),
        p("The Director of Information Security owns this policy and the security program. System owners are accountable for access "
          "to their systems. All personnel are responsible for complying with this policy."),
        p("3. Data Classification and Protection", H2),
        p("3.1 Customer data is classified as Confidential."),
        p("3.2 Confidential data at rest is encrypted using AES-256."),
        p("3.3 Data in transit over public networks is encrypted using TLS 1.2 or higher."),
    ])
    pages.append([
        p("4. Access Control", H2),
        p("4.1 Access is provisioned through an approved ticket and granted based on least privilege."),
        p("4.2 Multi-factor authentication is enforced for all interactive access to Acme systems, including administrative interfaces "
          "and remote access."),
        p("4.3 Shared accounts are prohibited except where technically required and approved by the Director of Information Security."),
        p("4.4 Access for terminated personnel is removed within one business day of termination."),
        p("4.5 User access rights to production systems are reviewed at least quarterly by system owners."),
        p("4.6 Administrative privileges are granted through separate administrative accounts that are not used for email or web browsing."),
    ])
    pages.append([
        p("5. Logging and Monitoring", H2),
        p("5.1 Security-relevant events from production systems are sent to a central SIEM and retained for at least 12 months."),
        p("6. Vulnerability Management", H2),
        p("6.1 Authenticated vulnerability scans of production are performed at least monthly."),
        p("6.2 An independent third party performs an external penetration test at least annually."),
        p("6.3 Critical vulnerabilities are remediated within 15 calendar days of identification. High vulnerabilities are remediated "
          "within 30 calendar days. Medium vulnerabilities are remediated within 90 calendar days."),
    ])
    pages.append([
        p("7. Incident Response", H2),
        p("7.1 Acme maintains an incident response plan that is reviewed and tested at least annually."),
        p("7.2 Affected customers are notified within 72 hours of Acme confirming a security incident involving their data."),
        p("8. Security Awareness", H2),
        p("8.1 All personnel complete security awareness training upon hire and annually thereafter."),
        p("8.2 Phishing simulations are conducted quarterly for all personnel."),
    ])
    pages.append([
        p("9. Business Continuity", H2),
        p("9.1 Acme maintains business continuity and disaster recovery plans for the Managed IT Services Platform, which are tested annually."),
        p("10. Records Retention", H2),
        p("10.1 Acme business records, including invoices and contracts, are retained for seven years."),
        p("11. Third Parties", H2),
        p("11.1 Vendors with access to customer data are assessed before onboarding and annually thereafter. AWS is the hosting "
          "provider for the Managed IT Services Platform."),
        p("12. Exceptions and Enforcement", H2),
        p("12.1 Exceptions to this policy must be documented and approved by the Director of Information Security. Violations may "
          "result in disciplinary action."),
    ])
    return build_pdf("acme_infosec_access_control_policy_v3.2.pdf", pages)


# =============================================================================
# 5. Access review export (evidence spreadsheet)
# =============================================================================

HEADER_FILL = PatternFill("solid", fgColor="E2E8F0")


def style_header(ws, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=1, column=c)
        cell.font = Font(bold=True)
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(wrap_text=True, vertical="top")


def access_review():
    wb = Workbook()
    ws = wb.active
    ws.title = "Q2-2026 Review"
    header = ["User", "Role", "System", "Reviewer", "Decision", "Review Sign-off", "Removal Date",
              "Days After Sign-off", "Within 10 Business Days", "Notes"]
    ws.append(header)
    people = [
        ("a.nguyen", "Engineer"), ("b.carter", "Engineer"), ("c.patel", "Support Lead"), ("d.ortiz", "Security"),
        ("e.wallace", "Engineer"), ("f.osei", "Support"), ("g.lindqvist", "Support"), ("h.moreno", "Engineer"),
        ("i.kowalski", "SRE"), ("j.tanaka", "SRE"), ("k.brennan", "Support"), ("l.haddad", "Engineer"),
        ("m.ferreira", "Finance"), ("n.okafor", "Support"), ("o.schultz", "Engineer"), ("p.raman", "IT Operations"),
        ("q.dubois", "Support"), ("r.ahmed", "Engineer"), ("s.kim", "Business Development"), ("t.becker", "Support"),
        ("u.silva", "Engineer"), ("v.ivanova", "SRE"), ("w.morgan", "Support"), ("x.chen", "Engineer"),
        ("ctr.jlopez", "Contractor"), ("ctr.mbaker", "Contractor"), ("ctr.rsingh", "Contractor"),
        ("ctr.tgreen", "Contractor"), ("svc.backup", "Service account"), ("svc.monitoring", "Service account"),
        ("y.rossi", "Engineer"),
    ]
    removals = {
        "ctr.jlopez": ("2026-05-08", 8, "Yes", ""),
        "ctr.mbaker": ("2026-06-10", 41, "No", "Removal ticket assigned to departed team member"),
        "ctr.rsingh": ("2026-06-10", 41, "No", "Removal ticket assigned to departed team member"),
        "ctr.tgreen": ("2026-05-06", 6, "Yes", ""),
    }
    for user, role in people:
        system = "AWS production" if role in ("Engineer", "SRE", "Security", "Contractor", "Service account") else "Identity provider"
        if user in removals:
            date, days, ok, note = removals[user]
            ws.append([user, role, system, "P. Raman", "Remove", "2026-04-30", date, days, ok, note])
        else:
            ws.append([user, role, system, "P. Raman", "Retain", "2026-04-30", "", "", "", ""])
    style_header(ws, len(header))
    for col, width in zip("ABCDEFGHIJ", [14, 18, 18, 11, 10, 15, 13, 12, 14, 44]):
        ws.column_dimensions[col].width = width

    s = wb.create_sheet("Summary")
    s.append(["Metric", "Value"])
    for row in [
        ["Review period", "Q2 2026"],
        ["Review sign-off date", "2026-04-30"],
        ["Accounts reviewed", 31],
        ["Accounts marked for removal", 4],
        ["Removed within 10 business days", 2],
        ["Removed late (more than 10 business days)", 2],
        ["Prepared by", "Priya Raman, IT Operations Manager"],
    ]:
        s.append(row)
    style_header(s, 2)
    s.column_dimensions["A"].width = 42
    s.column_dimensions["B"].width = 34
    wb.save(OUT / "acme_access_review_q2_2026.xlsx")


# =============================================================================
# 6. Buyer questionnaire (input)
# =============================================================================

QUESTIONS = [
    ("GOV-01", "Governance", "Does your organization maintain a documented information security policy that is approved by management and reviewed at least annually?"),
    ("GOV-02", "Governance", "Do you have a SOC 2 Type II report issued within the last 12 months? Provide the report period."),
    ("GOV-03", "Governance", "Were any exceptions noted in your most recent SOC 2 Type II report? If yes, describe them."),
    ("IAM-01", "Access Control", "Is multi-factor authentication enforced for all user access to systems that store or process client data, including administrative interfaces?"),
    ("IAM-02", "Access Control", "Is multi-factor authentication required for VPN and cloud console access to the production environment?"),
    ("IAM-03", "Access Control", "Is user access removed within 24 hours of an employee's termination?"),
    ("IAM-04", "Access Control", "Are user access reviews performed at least quarterly, with inappropriate access removed promptly?"),
    ("IAM-05", "Access Control", "Are privileged accounts separate from standard user accounts?"),
    ("DATA-01", "Data Protection", "Is client data encrypted at rest? Specify the encryption standard."),
    ("DATA-02", "Data Protection", "Is client data encrypted in transit using TLS 1.2 or higher?"),
    ("DATA-03", "Data Protection", "Where will Clearfield Financial data be stored? List data center regions."),
    ("DATA-04", "Data Protection", "Will Clearfield Financial data be returned or securely destroyed within 30 days of contract termination?"),
    ("DATA-05", "Data Protection", "Describe the physical security controls at the data centers that host client data."),
    ("VULN-01", "Vulnerability Management", "Do you perform authenticated vulnerability scans of production at least monthly?"),
    ("VULN-02", "Vulnerability Management", "What is your SLA for remediating critical vulnerabilities, and is it consistently met?"),
    ("VULN-03", "Vulnerability Management", "Do you perform an annual penetration test by an independent third party? Provide the date of the most recent test."),
    ("VULN-04", "Vulnerability Management", "Is endpoint detection and response (EDR) deployed on all endpoints and servers?"),
    ("TRN-01", "Security Awareness", "Do all personnel complete security awareness training at least annually? Provide the most recent completion rate."),
    ("TRN-02", "Security Awareness", "How frequently do you conduct phishing simulations?"),
    ("IR-01", "Incident Response", "Do you have a documented incident response plan tested within the last 12 months, and what is your client notification timeline?"),
    ("BCP-01", "Business Continuity", "Have your business continuity and disaster recovery plans been tested within the last 12 months?"),
    ("BCP-02", "Business Continuity", "What are your RTO and RPO for critical systems?"),
]


def questionnaire():
    wb = Workbook()
    ins = wb.active
    ins.title = "Instructions"
    for line in [
        ["Clearfield Financial - Vendor Security Questionnaire (SIG-Lite style)"],
        ["Version 2026.1"],
        [""],
        ["Answer each question in the Questionnaire tab. Response must be Yes, No, Partial, or N/A."],
        ["Provide an explanation and reference the supporting evidence (document name and page)."],
        ["Incomplete questionnaires will be returned. Clearfield Financial may request any referenced evidence."],
        [""],
        ["SYNTHETIC - FOR DEMONSTRATION ONLY"],
    ]:
        ins.append(line)
    ins["A1"].font = Font(bold=True, size=13)
    ins.column_dimensions["A"].width = 100

    ws = wb.create_sheet("Questionnaire")
    header = ["Ref", "Domain", "Question", "Response", "Explanation", "Evidence Reference"]
    ws.append(header)
    for ref, domain, q in QUESTIONS:
        ws.append([ref, domain, q, "", "", ""])
    style_header(ws, len(header))
    for col, width in zip("ABCDEF", [10, 24, 70, 12, 50, 30]):
        ws.column_dimensions[col].width = width
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(wrap_text=True, vertical="top")
    wb.save(OUT / "clearfield_vendor_security_questionnaire.xlsx")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    print("soc2 pages:", soc2())
    print("pentest pages:", pentest())
    print("phishing pages:", phishing())
    print("policy pages:", policy())
    access_review()
    questionnaire()
    print("wrote", OUT)
