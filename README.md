# shot

**Screenshots, checks and PR evidence for coding agents doing UI work.**

Coding agents change UI blind: they edit CSS, call the job done, and you find the broken phone layout in review. `shot` is a CLI that lets the agent see what it changed. It takes before and after stills of your app, runs layout and accessibility checks, records click-through flows as video, and puts all of it in the pull request.

```sh
git stash -u && shot /settings --as admin --label before
git stash pop && shot /settings --as admin --label after --size phone --size desktop --check
shot publish
```

```text
.shots/a1b2/after/route-settings--profile-admin-iphone-15-light-4c1e9a.png
.shots/a1b2/after/route-settings--profile-admin-1440x900-light-9f03d2.png
warn  target   /settings as admin@example.org › Profile: touch target 67×40, under 44×44 (#save)
```

## Why use it

- **The agent checks its own work.** It reads the PNGs it took before it says "done", so you get fewer rounds of "the button is off by 4px".
- **Before and after line up.** The same capture always gets the same file name, so `before/` and `after/` pair up without any setup. Shot doesn't run git. The agent stashes its change and shoots both states.
- **Every size in one run.** `--size phone --size desktop` shoots each size. Each size uses its own section list, so a sidebar that's hidden on phones isn't shot there.
- **Bugs you'd catch in review, caught earlier.** `--check` finds overflowing or clipped text, touch targets that are too small, missing focus rings, edges that are 1–3px out of line, and axe violations.
- **Reviewers see what changed.** `shot publish` writes the stills, flow videos and findings into the PR description: one sheet per capture, with a row per label and a column per size.
- **Logged-in pages work.** You give it a login hook once, and it keeps a session for each user. Requests that would change data (POST/PUT/PATCH/DELETE) are blocked, so a scene can't change your dev data.
- **It works with any framework.** It only needs a URL. Shot drives Playwright Chromium against your running dev server.

## Install

```sh
npm i -D agent-shot
npx playwright install chromium
```

You need Node ≥ 24. `shot publish` needs [`gh`](https://cli.github.com) ≥ 2.99. Videos are encoded with a bundled ffmpeg.

Give your agent the instructions. `shot skill` prints a skill file you can save to your agent's skills directory:

```sh
mkdir -p .claude/skills/shot && npx shot skill > .claude/skills/shot/SKILL.md
```

## Configure

URLs work without any config: `shot https://example.com`. To shoot your own app as a logged-in user, add a `shot.config.ts` at the project root:

```ts
import { axe } from '@agent-shot/axe'
import { defineConfig, github } from 'agent-shot'

export default defineConfig({
  app: {
    url: () => 'http://localhost:3000',
    health: '/health',
    users: { admin: 'admin@example.org', parent: 'parent@example.org' },
    logIn: async ({ page, url, user }) => {
      await page.goto(`${url}/login`)
      await page.fill('#email', user)
      await page.click('button[type=submit]')
    },
  },
  plugins: [axe(), github()],
})
```

`--as admin` logs in once and reuses the session after that. Optional hooks: `isLoginPage`, `waitUntilReady`, `applyTheme`, `writes: 'allow'`. You can also set `determinism` to fix the clock and random seed.

## Examples

```sh
# every section of a page, as a user
shot /app/persons --as admin

# list the section titles, then shoot one in light and dark
shot outline /app/persons --as admin
shot /app/persons --as admin --section "People" --mode both

# one element on a phone and a desktop, with box and gap overlays
shot /settings --as admin --select "#save" --size phone --size desktop --overlay boxes --overlay gaps

# a state: fill the form, press Enter, hover the button, then check it
shot /settings --as admin --fill '#name=Ada' --key Enter --hover "#save" --check

# 4× zoom on an icon, or its computed box, spacing, radius and font as JSON
shot /settings --as admin --select ".icon" --loupe 4
shot /settings --as admin --select "#save" --measure --style color

# an animation as 8 frames, 50ms apart
shot /app --as admin --click "#menu" --frames 8 --every 50

# the accessibility tree of a part
shot /settings --as admin --section "Profile" --aria
```

Run `shot --help` to see every flag.

## Flows

A flow is a Playwright script with named steps. Shot records a still for each step, an H.264 video that fits GitHub's upload limit, and a Playwright trace.

```ts
// shots/invite-parent.flow.ts
import { defineFlow } from 'agent-shot'

export default defineFlow({ start: '/app/persons', as: 'admin' }, async ({ page, step }) => {
  await step('open invite', () => page.getByRole('button', { name: 'Invite' }).click())
  await step('fill email', () => page.getByLabel('Email').fill('parent@example.org'))
  await step('submit', () => page.getByRole('button', { name: 'Send' }).click())
})
```

```sh
shot flow invite-parent --size phone --label after
```

## Output

- **stdout:** one path per file, and one line per finding (`error`/`warn`, check, target, message). Add `--json` for structured output.
- **Exit codes:** 0 when everything is ok. 1 on a render failure (500, redirect, timeout, failed step) or an error finding. 2 on a usage error.
- **Files:** `.shots/<session>/[<label>/]<source>--<slug>-<hash>.png`. A rerun overwrites the file. `shot clean` removes the session.

## Development

```text
packages/agent-shot   the CLI, capture domain, Playwright adapters, in-page runtime, GitHub publisher
plugins/axe           the axe-core check (@agent-shot/axe)
test/fixture-app      an app with a login, sections, a 500, a redirect and a PATCH; the adapter tests run against it
docs/spec.md          the spec
```

```sh
pnpm install
pnpm check   # tsc
pnpm test    # vitest, including the fixture app in Chromium
pnpm lint
```

Node ≥ 24 runs the TypeScript sources directly. Set `$SHOT_FFMPEG` to use your own ffmpeg.
