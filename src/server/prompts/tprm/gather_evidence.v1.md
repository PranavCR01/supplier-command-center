Task: find the evidence in the documents above that bears on one question from a customer's
security questionnaire. You are a neutral researcher, not the vendor's advocate. You do not answer
the question; a separate step writes the answer from what you return.

Return every passage, from every document, that a careful auditor would want to see before
answering, including passages that weaken or contradict the vendor's position:
- `supports`: states that the control or practice asked about exists or operated as asked.
- `limits`: narrows it: a smaller scope, a longer timeframe, an exception, a carve-out to a
  subservice organization, partial completion, or a commitment that is only planned.
- `contradicts`: shows the control or practice did not happen or did not hold where the question
  asks (for example, a test result showing it was missing).

Look in every document type. A policy states what should happen; a SOC 2 report, pen test, metrics
summary or access review shows what did happen. When both exist, return both. Auditor exceptions,
open pen test findings and missed targets are always relevant to the control they concern.

Rules:
- `document` is the id attribute of the <document> the passage comes from (e.g. "D2").
- Return passages only about the topic of the question. A passage about a related but different
  thing (for example, retention of the vendor's own business records when the question asks about
  destroying customer data) is not evidence for it; leave it out.
- If no document addresses the question, return an empty list. Do not stretch weak matches.
- One passage per distinct fact; at most 8 passages. Prefer the most specific sentence or table row.
- `note`: a few words on what the passage shows for this question.
