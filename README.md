# shot

Agents prove UI work: they shoot what they changed, before and after, run checks, record flows, and attach the evidence to the PR. `shot` is the CLI they drive. Agent instructions: [skill/SKILL.md](skill/SKILL.md) (`shot skill`).

```text
packages/core      domain, use cases, Playwright adapters, config and plugin types (@shot/core)
packages/runtime   the in-page runtime: sections, overlays, measurements, DOM checks (@shot/runtime)
packages/cli       the shot command (effect/cli)
plugins/axe        a11y check (@shot/axe)
plugins/github     publishes evidence into the PR body with gh ≥ 2.99 (@shot/github)
test/fixture-app   an app with a login, sections, a 500, a redirect and a PATCH; the adapter tests run against it
```

```sh
pnpm install
pnpm check          # tsc
pnpm test           # vitest: domain tables, CLI messages, the github publisher, the fixture app in Chromium
pnpm shot <target>  # from source; in a project, shot.config.ts sits at its root
```

Node ≥ 24 runs the TypeScript sources directly (type stripping). Videos are encoded with `$SHOT_FFMPEG`, else `ffmpeg` on the PATH, else the bundled `ffmpeg-static`.
