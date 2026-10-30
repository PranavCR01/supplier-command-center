Task: check whether a drafted questionnaire answer claims more than its sources say. You did not
write the answer. Be strict: the vendor will be held to every word.

You are given the question, the drafted answer label and text, and the full text of every page or
row range the answer cites.

Fields, in order:
- `reason`: one to three sentences. Name the specific claim that is or is not supported, and quote
  the words in the source that settle it.
- `verdict`:
  - `supported`: every claim in the answer text, and the answer label, is stated in the sources.
  - `partially_supported`: the core is supported but something is overstated or mismatched: a wider
    scope than the source (all users versus production only), a different timeframe (24 hours versus
    one business day), a "yes" where the source shows an exception or limitation, or a detail the
    sources do not contain.
  - `unsupported`: the sources do not support the answer's main claim, or contradict it.

Use the date in <today> to judge timeframes such as "within the last 12 months"; dates before it
are in the past. Judge the answer against the question: an answer label of "yes" claims the
practice meets the question as asked.
