import { axe } from '@agent-shot/axe'
import { defineConfig, definePlugin, github, isStill } from 'agent-shot'

/** A project's own check: plain async code, no Effect, no layer. */
const todos = definePlugin({
  name: 'todos',
  checks: [
    {
      check: 'todo',
      appliesTo: isStill,
      runCheck: async ({ roots }) => {
        const texts = await Promise.all(roots.map((root) => root.innerText()))

        return texts.some((text) => text.includes('TODO'))
          ? [{ severity: 'warn', message: 'TODO left in the page' }]
          : []
      },
    },
  ],
})

/** The fixture app's config: what a project writes, without Effect. */
export default defineConfig({
  app: {
    url: () => process.env['FIXTURE_URL'] ?? 'http://127.0.0.1:4173',
    health: '/health',
    users: { admin: 'admin@example.org' },
    logIn: async ({ page, url, user }) => {
      await page.goto(`${url}/login`)
      await page.fill('#email', user)
      await page.click('button[type=submit]')
      await page.waitForLoadState('load')
      const refused = page.locator('[role=alert]')

      if ((await refused.count()) > 0) throw new Error(await refused.innerText())
    },
  },
  plugins: [axe(), github(), todos],
})
