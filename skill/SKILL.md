---
name: shot
description: Prove UI work with the shot CLI: screenshots of app paths and URLs before and after a change, checks, recorded flows, and evidence on the PR. Use after changing UI, when asked to show, verify or screenshot a page, or to attach visual evidence to a pull request.
---

# shot

Shoot what you changed, before and after; check it; record the flow; publish the evidence to the PR. Read every PNG you produce before you claim anything about it.

## Prove a UI change

1. Find what to shoot: the app paths (with real ids) and the sections your change touches. `shot outline <path> --as <user>` lists section titles.
2. Shoot the old state: `git stash -u && shot <path> --as <user> --label before [flags]`. Complete when it printed a path per capture.
3. Shoot the new state with the same flags: `git stash pop && shot <path> --as <user> --label after [flags]`. The same capture gets the same file name under `before/` and `after/`.
4. Read both PNGs. Complete when you can name what changed and what did not.
5. For an interaction, write or reuse a flow (`shots/<name>.flow.ts`) and run `shot flow <name> --label after`.
6. `shot publish` puts every capture, flow and finding of the session into the PR body, replacing the last publish. Complete when it printed the PR's URL.

Shot does not run git: you stash, it shoots. A dev server with hot reload serves the stashed state too; one that builds once needs a restart.

## Targets and flags

```text
shot /settings --as admin                     one still per section, light (an app path: the config's app, logged in)
shot https://example.com                      a URL: no login, writes go through
shot /app/persons --as admin --mode both      light and dark
--section "Profile"  --select '#save'         part: a section by title, or the first visible match (+16px)
--select '[data-slot=card]:has-text("Billing")' --name billing
                                              any Playwright selector (role=, :has-text()); --name keeps the file name stable
--viewport  --mobile  --device "Pixel 8"  --width 390
--click a  --fill '#name=Ada'  --key Enter  --hover b  --focus c  --press d  --wait 300
                                              scene, in order; hover, focus and press run last and hold
--overlay boxes --overlay gaps (also edges, type, grid)  --loupe 4
--measure [--style color --style gap] [--all]  --aria  --frames 8 --every 50 [--slow 0.25]
--check                                       overflow, target, focus, align, and plugin checks (a11y)
--label before                                writes to .shots/<session>/before/
--as admin  --param org=acme                  the user (alias or email) and login params; shot login sets defaults
```

- Output: one path per file on stdout, findings one line each (`error`/`warn`, check, target, message). Measurements and aria trees print after their path. Progress goes to stderr. `--json` prints results as JSON.
- Exit 1: a render finding (the page 500s, redirects, times out, a step or part fails), an error finding, or a domain error. Exit 2: a usage mistake.
- App writes (POST, PUT, PATCH, DELETE to the app) are blocked and reported as console findings, so scenes cannot change dev data.
- Files: `.shots/<session>/[<label>/]<source>--<slug>-<hash>.png`; the session is `$SHOT_SESSION`, else your agent session id. A rerun overwrites. `shot clean` removes the session.

## Flows

```ts
// shots/invite-parent.flow.ts
import { defineFlow } from '@shot/core'

export default defineFlow({ start: '/app/persons', as: 'admin' }, async ({ page, step }) => {
  await step('open invite', () => page.getByRole('button', { name: 'Invite' }).click())
  await step('fill email', () => page.getByLabel('Email').fill('parent@example.org'))
  await step('submit', () => page.getByRole('button', { name: 'Send' }).click())
})
```

`shot flow invite-parent` writes a still per step, an H.264 video within GitHub's limit, and `trace.zip` (`npx playwright show-trace`). A failing step stops the flow: you get the stills up to it, the video so far, and the step's error; exit 1.

## When it fails

| Message                       | Do                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `needs a user`                | `--as <user>`, or `shot login --as <user>` once                               |
| `app not running at …`        | start the dev server in the background, then retry                            |
| `logIn hook failed for …`     | the user has no account, or the project's login changed: fix `shot.config.ts` |
| `no section "X"; sections: …` | pick a listed title, or `--select`                                            |
| `redirected to /login…`       | the session was renewed once and still bounced: the user lacks access         |
| `gh … cannot attach files`    | update gh to 2.99 or later                                                    |
| `no pull request for …`       | push and create the PR first                                                  |
