---
'agent-shot': minor
---

`app.writes` takes an allowlist: `writes: { allow: ['POST /api/sync'] }` lets the listed writes through (method and pathname, a trailing `*` matches a prefix) and blocks and reports every other one. An app that reads through a POST, like live sync, renders without `writes: 'allow'`.
