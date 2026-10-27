# agent-shot

## 0.1.0-beta.2

### Minor Changes

- 4bd264a: `shot publish <label>…` puts only what the agent picks on the PR: the named labels' sheets, narrowed with `--sheet`, each with an optional `--note "<part of title>=<text>"`. The evidence block is per sheet a heading, the note and one image with labels, sizes and modes drawn in; findings, flows and unlabelled scratch shots stay local. Breaking for publishers: `EvidenceReport` is `{ session, sheets }`.

  Agent output is leaner: progress goes to stderr only on a terminal, finding lines name the source and size only when a run shot several, and `shot flow` prints its stills (the trace only when a step fails). The skill is shorter; `shot skill review` prints the review workflow.

- c21a863: `checks` in `shot.config.ts` sets how loud each check is: `'off'` for every check, or `{ align: 'off', target: 'error' }` per check. The names are typed from the core checks and your plugins' checks, so a typo does not compile; an unknown name in a `.js` config fails the load. `render` failures always count.

  Plugins without needs (`axe()`, a plain `definePlugin`) now typecheck in `plugins`: `Layer` is contravariant in what it provides, so `ShotPlugin<never>` did not fit `ShotPlugin<any>`.

- f9d8662: With `--check`, a run prints only the findings its `before` capture (same flags, also shot with `--check`) does not have, and says how many it had too; `--base <label>` compares against another label. A pre-existing error no longer fails the run. Warnings print as a count; `--warnings` lists them. `--json` still has every finding.

## 0.1.0-beta.1

### Minor Changes

- 9c7b38b: Evidence sheets put light and dark on one sheet: a row per label, a column per size and mode, each size over its modes. Sheets draw at 2× with fixed-size headings, so they stay readable in a PR body. The evidence block has no heading and shows counts only when there are findings.
- a777565: Local HTML files are sources: `shot ./compare.html?variant=c` or a `file://` URL, no server needed.
- 3b39b3a: `shot review <label>…`: a local page where the user compares the labels the agent names side by side, votes per sheet, and draws comment pins, boxes, arrows and pen strokes on the stills. It blocks until the user sends or closes it and prints the feedback: picks, numbered notes with the element under each, and the stills with the drawings burned in. Stills now record an element map (`elements` in the manifest) for that.

### Patch Changes

- aa472dc: A page that is not ready within 20s now says what it waited for: the `waitUntilReady` hook, or the page load.

## 0.1.0-beta.0

### Minor Changes

- 669876d: First beta.
