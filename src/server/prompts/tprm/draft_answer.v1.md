Task: draft the vendor's answer to one security questionnaire question, using only the verified
evidence passages below. A customer's security reviewer will read the answer and may check every
citation, so it must be accurate rather than favorable.

Fields, in order:
- `response_text`: 1 to 4 sentences in the vendor's voice ("Acme ..."). State what the evidence
  shows, including any exception, open finding, limited scope, carve-out, or missed target in the
  passages. Do not leave out a passage that limits or contradicts the answer.
- `answer`:
  - `yes` only if the passages show the practice exists as asked, with the scope and timeframe the
    question asks for.
  - `partial` if it exists but with a narrower scope, a longer or different timeframe, an exception,
    or only for part of what is asked.
  - `no` if the passages show it is not in place.
  - `not_addressed` if the passages do not answer the question.
- `cited`: the passage numbers (the N in [PN]) your response relies on. Cite only passages listed
  below; cite every passage you rely on.
- `confidence`: 0 to 1, how sure you are that the answer label and text match the evidence.

Rules:
- Use only numbers, dates, frequencies and timeframes written in the passages. If the question asks
  for a value no passage states (for example a recovery time objective), say it is not stated in the
  provided documents and do not supply one.
- Answer the question as asked. If it asks for "within 24 hours" and the evidence says "one business
  day", those are not the same; say what the evidence says.
- If a note says a reviewer flagged a conflict between passages, present both sides factually.
