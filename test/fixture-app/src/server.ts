import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A tiny app for shot's adapter tests: a login form with a session cookie, sections, a page that 500s, one that
 * redirects, one that PATCHes on submit, and a slow animation. `/__logins` counts logins; `/__expire` ends every
 * session, as an app restart would.
 */

const accounts = new Set(['admin@example.org', 'parent@example.org'])

const layout = (
  title: string,
  body: string,
) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
  :root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif }
  body { margin: 0; padding: 24px; background: Canvas; color: CanvasText }
  section { border: 1px solid #8884; border-radius: 8px; padding: 16px; margin: 0 0 16px }
  button { font: inherit; padding: 6px 12px }
  .grow { animation: grow 600ms ease-out both; transform-origin: left }
  @keyframes grow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
</style></head><body>${body}</body></html>`

const sessions = new Map<string, string>()
let logins = 0
let generation = 0

const cookieOf = (request: IncomingMessage, name: string) =>
  (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1]

const userOf = (request: IncomingMessage) => {
  const token = cookieOf(request, 'session')

  return token === undefined ? undefined : sessions.get(token)
}

const send = (response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) => {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers })
  response.end(body)
}

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => resolve(body))
  })

const pages = new Map<string, (user: string) => string>([
  [
    '/app/persons',
    (user) =>
      layout(
        'Persons',
        `<h1>Persons</h1><p>Signed in as ${user}</p>
<section><h2>People</h2><ul><li>Ada Lovelace</li><li>Grace Hopper</li></ul><button id="invite">Invite</button></section>
<section aria-label="Filters"><label>Name <input id="name"></label></section>
<div id="dialog" hidden><section><h2>Invite</h2><label>Email <input id="email" type="email"></label><button id="send">Send</button><p id="sent" hidden>Sent</p></section></div>
<script>
  document.getElementById('invite').onclick = () => { document.getElementById('dialog').hidden = false }
  document.getElementById('send').onclick = () => { document.getElementById('sent').hidden = false }
</script>`,
      ),
  ],
  [
    '/settings',
    () =>
      layout(
        'Settings',
        `<h1>Settings</h1><section><h2>Profile</h2><form id="form"><label>Name <input id="name" name="name"></label><button type="submit">Save</button></form><p id="status"></p></section>
<script>
  document.getElementById('form').onsubmit = async (event) => {
    event.preventDefault()
    try { await fetch('/api/settings', { method: 'PATCH', body: JSON.stringify({ name: document.getElementById('name').value }) }); document.getElementById('status').textContent = 'Saved' }
    catch { document.getElementById('status').textContent = 'Not saved' }
  }
</script>`,
      ),
  ],
  [
    '/animated',
    () =>
      layout(
        'Animated',
        '<section><h2>Bar</h2><div class="grow" style="height:24px;background:#2563eb"></div></section>',
      ),
  ],
])

const handle = async (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url ?? '/', 'http://fixture')

  if (url.pathname === '/health') return send(response, 200, 'ok')

  if (url.pathname === '/__logins') return send(response, 200, String(logins))

  if (url.pathname === '/__expire') {
    sessions.clear()
    generation++

    return send(response, 200, 'expired')
  }

  if (url.pathname === '/login' && request.method === 'GET') {
    return send(
      response,
      200,
      layout(
        'Log in',
        `<form method="post" action="/login"><label>Email <input id="email" name="email"></label><button type="submit">Log in</button></form>${url.searchParams.has('error') ? '<p role="alert">no account</p>' : ''}`,
      ),
    )
  }

  if (url.pathname === '/login' && request.method === 'POST') {
    const email = new URLSearchParams(await readBody(request)).get('email') ?? ''

    if (!accounts.has(email)) return send(response, 303, '', { location: '/login?error=1' })
    logins++
    const token = `${generation}-${Math.random().toString(36).slice(2)}`
    sessions.set(token, email)

    return send(response, 303, '', { location: '/app/persons', 'set-cookie': `session=${token}; Path=/; HttpOnly` })
  }

  if (url.pathname === '/broken') return send(response, 500, layout('Broken', '<h1>Internal error</h1>'))

  if (url.pathname === '/app/missing') return send(response, 302, '', { location: '/404' })

  if (url.pathname === '/404') return send(response, 200, layout('Not found', '<h1>Not found</h1>'))

  if (url.pathname.startsWith('/api/')) return send(response, 200, '{}', { 'content-type': 'application/json' })
  const page = pages.get(url.pathname)

  if (page === undefined) return send(response, 404, layout('Not found', '<h1>Not found</h1>'))
  const user = userOf(request)

  if (user === undefined)
    return send(response, 302, '', { location: `/login?next=${encodeURIComponent(url.pathname)}` })

  return send(response, 200, page(user))
}

export const startFixtureApp = (port = 0): Promise<{ readonly server: Server; readonly url: string }> =>
  new Promise((resolve) => {
    const server = createServer((request, response) => void handle(request, response))
    server.listen(port, '127.0.0.1', () => {
      // SAFETY: a listening TCP server's address is an AddressInfo; null and string are for unbound and pipe servers.
      const { port: bound } = server.address() as AddressInfo
      resolve({ server, url: `http://127.0.0.1:${bound}` })
    })
  })

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startFixtureApp(Number(process.env['PORT'] ?? 4173))
  process.stdout.write(`fixture app at ${url}\n`)
}
