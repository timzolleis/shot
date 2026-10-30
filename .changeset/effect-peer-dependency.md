---
'agent-shot': minor
'@agent-shot/axe': minor
---

`effect` and `@effect/platform-node` are peer dependencies now (`^4.0.5`): shot runs on the app's own Effect instead of installing a second copy. An app on another Effect 4 version no longer gets a mismatched `@effect/platform-node-shared` (4.0.5's `@effect/platform-node` took `^4.0.5` of it, resolved 4.1.0, and crashed on start). Apps add `effect` and `@effect/platform-node` themselves.
