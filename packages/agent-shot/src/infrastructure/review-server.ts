import { Deferred, Effect, Layer, Match, Option, Schema } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import { build } from 'esbuild'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { ArtifactStore } from '../artifact/artifact-store.ts'
import { ReviewServer } from '../review/application/review-service.ts'
import { ClosedReview, ReviewDraft, type ReviewEnd, SubmittedReview } from '../review/domain/review.ts'
import { reviewPageEntry } from '../review-ui/entry.ts'
import { runProcess } from './run-process.ts'

/** The page ends as closed when no tab has been connected for this long (F33). */
const leaseMs = 30_000
const heartbeatMs = 15_000
const maxBodyBytes = 5 * 1024 * 1024

const decodeReviewDraft = Schema.decodeUnknownOption(Schema.fromJsonString(ReviewDraft))

const bundleReviewPage = Effect.promise(async () => {
  const result = await build({
    entryPoints: [reviewPageEntry],
    bundle: true,
    format: 'iife',
    write: false,
    target: 'chrome120',
    logLevel: 'silent',
  })

  return result.outputFiles[0]!.text
})

const reviewHtml = (script: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>shot review</title></head><body><div id="app"></div><script>${script.replaceAll('</script', '<\\/script')}</script></body></html>`

const readBody = (request: IncomingMessage) =>
  new Promise<Option.Option<string>>((resolve) => {
    const chunks: Array<Buffer> = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length

      if (size > maxBodyBytes) {
        resolve(Option.none())
        request.destroy()

        return
      }

      chunks.push(chunk)
    })
    request.on('end', () => resolve(Option.some(Buffer.concat(chunks).toString('utf8'))))
    request.on('error', () => resolve(Option.none()))
  })

const send = ({
  response,
  status,
  body,
  type,
}: {
  readonly response: ServerResponse
  readonly status: number
  readonly body: string | Uint8Array
  readonly type: string
}) => {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  response.end(body)
}

const browserCommand = (url: string) =>
  Match.value(process.platform).pipe(
    Match.when('darwin', () => ({ command: 'open', args: [url] })),
    Match.when('win32', () => ({ command: 'cmd', args: ['/c', 'start', '', url] })),
    Match.orElse(() => ({ command: 'xdg-open', args: [url] })),
  )

/**
 * node:http on 127.0.0.1 and a random port. Every request carries the session token and a loopback Host, so another
 * site in the browser cannot read the stills or end the review. The first decision wins (F33).
 */
export const NodeReviewServerLayer = Layer.effect(
  ReviewServer,
  Effect.gen(function* () {
    const artifacts = yield* ArtifactStore
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

    return ReviewServer.of({
      serveReview: ({ page, files, saveDraft, open, onListening }) =>
        Effect.gen(function* () {
          const html = reviewHtml(yield* bundleReviewPage)
          const ended = yield* Deferred.make<ReviewEnd>()
          const token = randomBytes(16).toString('hex')
          const allowed = new Set(files)
          const settle = (end: ReviewEnd) => Effect.runSync(Deferred.succeed(ended, end))
          const isSettled = () => Effect.runSync(Deferred.isDone(ended))
          let tabs = 0
          let everConnected = false
          let leaseTimer: ReturnType<typeof setTimeout> | undefined
          const heartbeats = new Set<ReturnType<typeof setInterval>>()
          const streams = new Set<ServerResponse>()
          let stopped = false
          let port = 0

          const handle = async (request: IncomingMessage, response: ServerResponse) => {
            const url = new URL(request.url ?? '/', 'http://127.0.0.1')
            const host = request.headers.host ?? ''

            if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
              return send({ response, status: 403, body: 'wrong host', type: 'text/plain' })
            }

            const given = request.headers['x-shot-token'] ?? url.searchParams.get('t')

            if (given !== token) return send({ response, status: 403, body: 'wrong token', type: 'text/plain' })

            if (request.method === 'GET' && url.pathname === '/') {
              return send({ response, status: 200, body: html, type: 'text/html; charset=utf-8' })
            }

            if (request.method === 'GET' && url.pathname === '/api/review') {
              return send({ response, status: 200, body: JSON.stringify(page), type: 'application/json' })
            }

            if (request.method === 'GET' && url.pathname === '/files') {
              const file = url.searchParams.get('file') ?? ''

              if (!allowed.has(file)) return send({ response, status: 404, body: 'not found', type: 'text/plain' })
              const png = await readFile(artifacts.absolutePath(file))

              return send({ response, status: 200, body: png, type: 'image/png' })
            }

            if (request.method === 'GET' && url.pathname === '/api/lease') {
              response.writeHead(200, {
                'content-type': 'text/event-stream',
                'cache-control': 'no-store',
                connection: 'keep-alive',
              })
              response.write(': connected\n\n')
              tabs++
              everConnected = true
              clearTimeout(leaseTimer)
              const heartbeat = setInterval(() => response.write(': ping\n\n'), heartbeatMs)
              heartbeats.add(heartbeat)
              streams.add(response)
              // The response closes with the connection; the request closes once read, which a GET is at once.
              response.on('close', () => {
                clearInterval(heartbeat)
                heartbeats.delete(heartbeat)
                streams.delete(response)
                tabs--

                // Closing the server closes every tab's stream: no lease to start then.
                if (tabs === 0 && everConnected && !stopped) {
                  leaseTimer = setTimeout(() => {
                    if (tabs === 0 && !isSettled()) settle(ClosedReview.make({}))
                  }, leaseMs)
                }
              })

              return
            }

            const isDraft = request.method === 'PUT' && url.pathname === '/api/draft'
            const isSubmit = request.method === 'POST' && url.pathname === '/api/submit'
            const isClose = request.method === 'POST' && url.pathname === '/api/close'

            if (!isDraft && !isSubmit && !isClose) {
              return send({ response, status: 404, body: 'not found', type: 'text/plain' })
            }

            if (isSettled()) {
              return send({ response, status: 409, body: '{"ended":true}', type: 'application/json' })
            }

            if (isClose) {
              response.on('finish', () => settle(ClosedReview.make({})))

              return send({ response, status: 200, body: '{"ok":true}', type: 'application/json' })
            }

            const body = await readBody(request)
            const draft = Option.flatMap(body, decodeReviewDraft)

            if (Option.isNone(draft)) {
              return send({ response, status: 400, body: '{"error":"invalid draft"}', type: 'application/json' })
            }

            if (isDraft) {
              await Effect.runPromise(saveDraft(draft.value))

              return send({ response, status: 200, body: '{"ok":true}', type: 'application/json' })
            }

            response.on('finish', () => settle(SubmittedReview.make({ draft: draft.value })))

            return send({ response, status: 200, body: '{"ok":true}', type: 'application/json' })
          }

          const server = yield* Effect.acquireRelease(
            Effect.callback<ReturnType<typeof createServer>>((resume) => {
              const created = createServer((request, response) => {
                handle(request, response).catch((error: Error) =>
                  send({ response, status: 500, body: error.message, type: 'text/plain' }),
                )
              })

              created.listen(0, '127.0.0.1', () => resume(Effect.succeed(created)))
            }),
            (started) =>
              Effect.sync(() => {
                stopped = true
                clearTimeout(leaseTimer)

                for (const heartbeat of heartbeats) clearInterval(heartbeat)

                for (const stream of streams) stream.end()
                started.closeAllConnections()
                started.close()
              }),
          )

          // SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name.
          port = (server.address() as AddressInfo).port
          const url = `http://127.0.0.1:${port}/?t=${token}`
          yield* onListening(url)

          if (open) {
            const { command, args } = browserCommand(url)
            yield* runProcess({ command, args }).pipe(
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            )
          }

          return yield* Deferred.await(ended)
        }).pipe(Effect.scoped),
    })
  }),
)
