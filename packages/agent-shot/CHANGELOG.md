# agent-shot

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
