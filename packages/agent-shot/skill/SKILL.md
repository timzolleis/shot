---
name: shot
description: Screenshot an app path or URL with the shot CLI (agent-shot), with layout and a11y checks, and put the shots on a pull request. Use when UI work needs visual verification, when asked to show or screenshot a page, or to let the user choose between variants you built.
---

# shot

Shoot rarely. Normal implementation work takes no screenshots: the repo's checks are the evidence. Shoot when UI work needs visual verification, and then once at the end, to find and fix issues.

## Verify a UI change

1. Before you change anything, shoot each screen you will touch: `shot <path> --as <user> --section "<Title>" --label before`. `shot outline <path> --as <user>` lists section titles.
2. Make the change, and get the repo's checks green.
3. Shoot the same screens with the same flags: `shot <path> --as <user> --section "<Title>" --label after --check`. Same flags give the same file name under `before/` and `after/`.
4. Read every PNG you took. Fix what your change broke, and shoot `after` again.
5. With a PR open: `shot publish before after --note "<part of a sheet title>=<what changed, one sentence>"`.

Shots without `--label` are scratch and never reach the PR.

## Output and exit codes

stdout: one path per PNG, one line per finding, then one summary line: `shot: 3 captures · 0 failed · 2 findings (1 error) · 1 also in before`. Progress goes to stderr, so read stdout whole.

- Exit 0: every capture was taken. Findings are reported, not failed; `--check` prints only findings `--base` (default `before`) lacks, and `--strict` exits 1 on a new error finding.
- Exit 1: shot could not take a picture: render error, timeout, login, a stopped flow, or the app did not start.
- Exit 2: a usage mistake; the help follows.

## Flags

```text
<path> --as <user>     app path as a user (config alias or email); <url> or ./page.html needs no login
--section "Title"  --select '#save'  --viewport     the part to shoot; none = one still per section
--size phone|tablet|laptop|desktop|WxH   --mode light|dark|both
--click a --fill '#name=Ada' --key Enter --hover b --focus c   the scene, in order
--check  --strict  --warnings  --label <name>  --json
```

A sequence no scene reaches gets a flow: `shots/<name>.flow.ts` with `defineFlow`, run by `shot flow <name> --label after`. To let the user pick between variants, run `shot skill review`.

## Setup

App paths need `shot.config.ts` at the project root: `app.url`, `app.logIn`, and `app.users` for `--as` aliases. `app.start` starts the app when `app.url` does not answer (for example, it spawns `ship up` detached); shot then waits up to `app.startTimeoutMs` (default 120 s). App writes are blocked unless listed in `app.writes: { allow: ['POST /api/sync'] }`.

## When it fails

| Message                          | Do                                                                  |
| -------------------------------- | ------------------------------------------------------------------- |
| `app not running at …`           | set `app.start` in `shot.config.ts`, or start the app               |
| `app.start ran, but … within …s` | read the dev server's output                                        |
| `needs a user`                   | `--as <user>`, or `shot login --as <user>` once                     |
| `logIn hook failed for …`        | the user has no account, or the login changed: fix `shot.config.ts` |
| `no section "X"; sections: …`    | pick a listed title, or `--select`                                  |
| `redirected to /login…`          | the user lacks access to that path                                  |
| `no pull request for …`          | push and create the PR first                                        |
