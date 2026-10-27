---
'agent-shot': minor
---

`shot publish <label>…` puts only what the agent picks on the PR: the named labels' sheets, narrowed with `--sheet`, each with an optional `--note "<part of title>=<text>"`. The evidence block is per sheet a heading, the note and one image with labels, sizes and modes drawn in; findings, flows and unlabelled scratch shots stay local. Breaking for publishers: `EvidenceReport` is `{ session, sheets }`.

Agent output is leaner: progress goes to stderr only on a terminal, finding lines name the source and size only when a run shot several, and `shot flow` prints its stills (the trace only when a step fails). The skill is shorter; `shot skill review` prints the review workflow.
