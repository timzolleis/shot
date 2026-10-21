import { defineFlow } from 'agent-shot'

export default defineFlow({ start: '/app/persons', as: 'admin' }, async ({ page, step }) => {
  await step('open invite', () => page.locator('#invite').click())
  await step('fill email', () => page.locator('#email').fill('parent@example.org'))
  await step('submit', () => page.locator('#submit-that-does-not-exist').click({ timeout: 1500 }))
})
