## fathohm check — FAIL

*acme-api · 2026-07-31T00:00:00Z · scorer v4*

FAIL — even with full credit for every review git cannot see, 24% of this repository sits below the line (22K of the 92K read), over your limit of 10%.

Comprehension debt: code no human has recently written, reviewed, or explained — measured from the record, not a survey.

**Where the dark code is** — no human wrote or prompted these in the last 180 days. A different cut from the line above, and the first three the reading names, in its own order (group, then application code, then bytes):

- `components/Map.tsx` — hand-written 300d ago · 1 human in its history
- `lib/map-tree.ts` — hand-written 220d ago · 2 humans in its history
- `lib/palette.ts` — hand-written 220d ago · 2 humans in its history

---

Reproduce it on any clone: `npx fathohm check --max-blind 10` — git metadata only, no network, nothing written.

Authorship is declared, not detected: undeclared agent work reads as human. Git records no pull-request reviews; the hosted reading does — https://fathohm.dev
