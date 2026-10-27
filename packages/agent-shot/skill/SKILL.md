---
name: shot
description: Screenshot UI work with the shot CLI (agent-shot): stills of app paths and URLs before and after a change, at several sizes, with layout and a11y checks; recorded flows; the sheets you pick on the PR; a local page where the user picks between variants. Use after changing UI, when asked to show, verify or screenshot a page, to put screenshots on a pull request, or to let the user choose between variants you built.
---

# shot

`shot` drives Chromium against the running app. stdout: one path per PNG, then one line per finding. Exit 1: a capture failed or an `error` finding. Exit 2: a usage mistake.

## Prove a UI change

1. Find each screen your change touches: an app path with real ids, and the part that changed. `shot outline <path> --as <user>` lists section titles. Shoot that part (`--section`, `--select`), not the whole page. Complete when you have a path and a part per changed screen.
2. Shoot the old state: `git stash -u && shot <path> --as <user> --label before [flags]`.
3. Shoot the new state with the same flags: `git stash pop && shot <path> --as <user> --label after [flags]`. Same flags give the same file name under `before/` and `after/`, and one sheet on the PR. Complete when every `after` path has a `before` twin.
4. Read each pair. Complete when you can name what changed and what did not, at each size you shot.
5. Add `--check` to the after run. Fix the `error` findings your change caused; findings `before` has too are not yours.
6. Publish: `shot publish before after --note "<part of a sheet title>=<what changed, one sentence>"`. Complete when it printed the PR's URL.

Shot does not run git. A dev server with hot reload serves the stashed state; one that builds once needs a restart.

Shots without `--label` are scratch: look around with them freely, they never reach the PR.

## Publish

`shot publish <label>…` replaces the evidence block in the PR body with the sheets you pick: per sheet a heading, your note, and one image with a row per label and a column per size and mode. Nothing else goes up: no findings, no flows.

- `--note "<part of title>=<text>"` picks a sheet and puts the text under it; repeatable. Say what the reviewer should see, not how you shot it.
- `--sheet "<part of title>"` picks a sheet without a note; repeatable.
- No `--note` or `--sheet`: every sheet the labels have.
- A part that matches no sheet fails and lists the titles.

## Examples

```sh
shot /app/persons --as admin --section People --mode both          # one section, light and dark
shot /settings --as admin --select "#save" --size phone --size desktop
shot /settings --as admin --fill '#name=Ada' --key Enter --hover "#save" --check
shot /settings --as admin --select "#save" --measure --style color   # box, spacing, radius, font as JSON
shot /settings --as admin --select ".icon" --loupe 4                 # pixel detail
shot /app --as admin --click "#menu" --frames 8 --every 50           # an animation on one sheet
shot https://example.com --size "Pixel 8"                            # any URL, no login
shot ./compare.html?variant=c                                        # a local HTML file
```

## Flags

```text
<path> --as <user>     app path as a user (config alias or email); `shot login --as <user>` sets a default
<url> | ./page.html    any URL or local HTML file; no login
--section "Title"      a section by title (exact, else unique substring); repeatable
--select '#save'       first visible match of a Playwright selector, 16px around it; repeatable
--viewport             only the viewport; no part flag = one still per section
--name billing         fixed file name, for selectors that change
--size phone|tablet|laptop|desktop|WxH|"<Playwright device>"   repeatable; default laptop
--mode light|dark|both
--click a --fill '#name=Ada' --key Enter --wait 300 --hover b --focus c --press d
                       the scene, in order; hover, focus and press run last and hold
--overlay boxes|gaps|edges|type|grid   --loupe 4   --measure [--style x] [--all]   --aria   --frames 8 [--every 50]
--check                overflow, target, focus, align, plugin checks
--label before         writes to .shots/<session>/before/
--json                 results as JSON
```

- Each size shoots the sections its own layout shows; a `--section` that a size hides fails at that size.
- App writes (POST, PUT, PATCH, DELETE) are blocked and reported, so a scene cannot change dev data.
- A rerun with the same flags overwrites its file. `shot clean` deletes the session.

## Flows

```ts
// shots/invite-parent.flow.ts
import { defineFlow } from 'agent-shot'

export default defineFlow({ start: '/app/persons', as: 'admin' }, async ({ page, step }) => {
  await step('open invite', () => page.getByRole('button', { name: 'Invite' }).click())
  await step('submit', () => page.getByRole('button', { name: 'Send' }).click())
})
```

`shot flow <name> [--size phone] [--label after]` prints a still per step. A failing step stops the flow, prints the error and the trace (`npx playwright show-trace <trace>`), and exits 1.

## Let the user choose

When you built variants and the user should pick, run `shot skill review` and follow it.

## Setup

App paths need a `shot.config.ts` at the project root. Without one, shoot URLs, or ask the user how their app logs in:

```ts
import { defineConfig, github } from 'agent-shot'

export default defineConfig({
  app: {
    url: () => 'http://localhost:3000',
    users: { admin: 'admin@example.org' },
    logIn: async ({ page, url, user }) => {
      await page.goto(`${url}/login`)
      await page.fill('#email', user)
      await page.click('button[type=submit]')
    },
  },
  plugins: [github()],
})
```

## When it fails

| Message                       | Do                                                                  |
| ----------------------------- | ------------------------------------------------------------------- |
| `needs a user`                | `--as <user>`, or `shot login --as <user>` once                     |
| `app not running at …`        | start the dev server in the background, then retry                  |
| `logIn hook failed for …`     | the user has no account, or the login changed: fix `shot.config.ts` |
| `no section "X"; sections: …` | pick a listed title, or `--select`                                  |
| `redirected to /login…`       | the user lacks access to that path                                  |
| `unknown label …`             | shoot that label first, or pick a listed one                        |
| `no sheet matches …`          | use part of a listed title                                          |
| `no publisher configured`     | add `github()` to `plugins` in `shot.config.ts`                     |
| `no pull request for …`       | push and create the PR first                                        |
| `gh … cannot attach files`    | update gh to 2.99 or later                                          |
