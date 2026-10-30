# @agent-shot/axe

## 0.2.0

### Minor Changes

- b8c7c0c: `effect` and `@effect/platform-node` are peer dependencies now (`^4.0.5`): shot runs on the app's own Effect instead of installing a second copy. An app on another Effect 4 version no longer gets a mismatched `@effect/platform-node-shared` (4.0.5's `@effect/platform-node` took `^4.0.5` of it, resolved 4.1.0, and crashed on start). Apps add `effect` and `@effect/platform-node` themselves.

### Patch Changes

- Updated dependencies [b8c7c0c]
  - agent-shot@0.2.0

## 0.1.0

### Minor Changes

- 669876d: First beta.

### Patch Changes

- c21a863: `checks` in `shot.config.ts` sets how loud each check is: `'off'` for every check, or `{ align: 'off', target: 'error' }` per check. The names are typed from the core checks and your plugins' checks, so a typo does not compile; an unknown name in a `.js` config fails the load. `render` failures always count.

  Plugins without needs (`axe()`, a plain `definePlugin`) now typecheck in `plugins`: `Layer` is contravariant in what it provides, so `ShotPlugin<never>` did not fit `ShotPlugin<any>`.

- Updated dependencies [4bd264a]
- Updated dependencies [c21a863]
- Updated dependencies [9c7b38b]
- Updated dependencies [a777565]
- Updated dependencies [669876d]
- Updated dependencies [f9d8662]
- Updated dependencies [aa472dc]
- Updated dependencies [3b39b3a]
  - agent-shot@0.1.0

## 0.1.0-beta.2

### Patch Changes

- c21a863: `checks` in `shot.config.ts` sets how loud each check is: `'off'` for every check, or `{ align: 'off', target: 'error' }` per check. The names are typed from the core checks and your plugins' checks, so a typo does not compile; an unknown name in a `.js` config fails the load. `render` failures always count.

  Plugins without needs (`axe()`, a plain `definePlugin`) now typecheck in `plugins`: `Layer` is contravariant in what it provides, so `ShotPlugin<never>` did not fit `ShotPlugin<any>`.

- Updated dependencies [4bd264a]
- Updated dependencies [c21a863]
- Updated dependencies [f9d8662]
  - agent-shot@0.1.0-beta.2

## 0.1.0-beta.1

### Patch Changes

- Updated dependencies [9c7b38b]
- Updated dependencies [a777565]
- Updated dependencies [aa472dc]
- Updated dependencies [3b39b3a]
  - agent-shot@0.1.0-beta.1

## 0.1.0-beta.0

### Minor Changes

- 669876d: First beta.

### Patch Changes

- Updated dependencies [669876d]
  - agent-shot@0.1.0-beta.0
