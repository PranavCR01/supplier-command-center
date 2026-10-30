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

Each item has `text` (one sentence, plain language, numbers as written in the document), plus a
`location` and verbatim `quote` that support it.
