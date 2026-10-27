---
'agent-shot': minor
'@agent-shot/axe': patch
---

`checks` in `shot.config.ts` sets how loud each check is: `'off'` for every check, or `{ align: 'off', target: 'error' }` per check. The names are typed from the core checks and your plugins' checks, so a typo does not compile; an unknown name in a `.js` config fails the load. `render` failures always count.

Plugins without needs (`axe()`, a plain `definePlugin`) now typecheck in `plugins`: `Layer` is contravariant in what it provides, so `ShotPlugin<never>` did not fit `ShotPlugin<any>`.
