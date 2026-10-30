Task: decide whether the evidence passages below, taken from different documents, make
incompatible claims that bear on the question.

A conflict exists only when two passages from different documents cannot both be true for the same
control, the same scope, and the same period. Typical case: a policy states a control applies to
all systems or always happens, and a test, report or metric shows it did not happen for some system
or some period covered by that statement.

Not a conflict:
- Different wording that is compatible ("within one business day" and "promptly").
- One passage covers a different system or scope than the other (VPN access versus a web portal).
- A policy that is stricter than what was tested, when the test still meets the question.
- An auditor exception or late activity that every document agrees on. Disclosed exceptions are a
  separate issue, not a conflict between documents.
- A passage that only adds detail to another.

Return `conflict`: true or false. If true, `a` and `b` are the passage numbers (the N in [PN]) of
the two passages that clash, from different documents, with `a` the stated commitment and `b` the
evidence against it. `explanation`: one or two sentences a reviewer can check, naming what each
passage says. If false, set `a` and `b` to null and explain briefly why the passages are compatible.
