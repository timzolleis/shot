import { axe } from '@shot/axe'
import { defineConfig } from '@shot/core'
import { github } from '@shot/github'

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
  plugins: [axe(), github()],
})
