Task: write a summary card for the document above, for the vendor's security team.

The structured findings already extracted from this document are listed after this prompt. Use them
to decide what matters, but quote the document itself, not the findings.

Fields:
- `headline`: one sentence: what the document is, who produced it, and the period or date it covers.
- `top_findings`: 2 to 5 of the most important facts a customer's reviewer would look for.
- `key_exceptions`: every auditor exception, every open Critical or High pen test finding, every
  late or missed control activity, and every place the document shows something was not done as
  required. Use an empty list only if the document records none. Never omit an exception to make
  the vendor look better.
- `takeaways`: 1 to 3 things the vendor must act on or disclose when answering security questions
  (for example: a subservice organization whose own report the customer must obtain, a finding that
  is still open, a target that was missed).

Each item has `text` (one sentence, plain language), plus a `location` and verbatim `quote`.

Rules for items:
- When the document gives an ID for a control, finding, or row (e.g. "CC6.2", "PT-01", "Row 27"),
  start the item's `text` with that ID and a colon, so a reviewer can trace it.
- The `quote` must support everything the `text` says. If a sentence needs facts from two places,
  write two items instead.
- Use only numbers that appear in the document, written as they appear. Do not calculate
  differences, totals, overdue days, or percentages, and do not count findings yourself; if the
  document states a count, use that count.
