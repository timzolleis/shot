---
'agent-shot': minor
---

`app.start` starts the app when `app.url` does not answer, and shot waits up to `app.startTimeoutMs` (default 120 s) for it; two runs that find it down start it once. Findings no longer fail a run: exit 1 means a capture could not be taken, and `--strict` brings back exit 1 on a new error finding. Every run ends with one summary line, `shot: 3 captures · 0 failed · 2 findings (1 error) · 1 also in before`. The skill is one screen long and shoots `before` first instead of stashing.
