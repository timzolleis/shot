import { Effect, Option } from 'effect'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { UrlSource, type Variant } from '../capture/domain/capture.ts'
import { SourceNotFoundError, SourceRenderFailedError, SourceTimedOutError } from '../capture/domain/capture-error.ts'
import type { OpenSourceOptions } from '../capture/application/source-providers.ts'
import type { RouteSourceDeps } from '../app/route-source-provider.ts'
import {
  collectPageErrors,
  contextOptionsFromVariant,
  createErrorLog,
  prepareContext,
  type ReadyPage,
  renderTimeoutMs,
  settlePage,
  trackNetwork,
} from './page-lifecycle.ts'

const firstLine = (cause: unknown) => (String(cause).split('\n')[0] ?? '').replace(/^\w+: /, '')

/** `file://…`, `./page.html` or `../page.html`: a local page, shot like a URL. */
export const isFileSourceText = (raw: string): boolean => /^(file:\/\/|\.\.?\/)/.test(raw)

/**
 * A local page as a `file://` URL. A relative path resolves against the project root and keeps its query and hash
 * (`./compare.html?variant=c`); the file must exist.
 */
export const resolveFileSource = ({ raw, projectRoot }: { readonly raw: string; readonly projectRoot: string }) =>
  Effect.gen(function* () {
    const url = raw.startsWith('file://')
      ? new URL(raw)
      : (() => {
          const [, file = '', rest = ''] = /^([^?#]*)(.*)$/.exec(raw) ?? []

          return new URL(`${pathToFileURL(path.resolve(projectRoot, file)).href}${rest}`)
        })()

    const isFile = yield* Effect.promise(() =>
      stat(url).then(
        (stats) => stats.isFile(),
        () => false,
      ),
    )

    if (!isFile) return yield* new SourceNotFoundError({ raw, reason: 'no such file' })

    return UrlSource.make({ url: url.href })
  })

/** A URL: load, network quiet, settled. Writes go through: it is not the project's dev data. */
export const openUrlSource = ({
  deps,
  source,
  variant,
  options,
}: {
  readonly deps: Pick<RouteSourceDeps, 'browser' | 'runtime' | 'config'>
  readonly source: UrlSource
  readonly variant: Variant
  readonly options: OpenSourceOptions
}) =>
  Effect.gen(function* () {
    const contextOptions = yield* contextOptionsFromVariant(variant)

    const context = yield* deps.browser.newContext({
      ...contextOptions,
      ...Option.match(options.recordVideoDir, {
        onNone: () => ({}),
        onSome: (dir) => ({ recordVideo: { dir, size: contextOptions.viewport ?? { width: 1280, height: 900 } } }),
      }),
    })

    const hasDeterminism = deps.config.determinism.fixedTime !== undefined || deps.config.determinism.seed !== undefined
    yield* prepareContext({
      context,
      slow: options.slowClock,
      determinism: hasDeterminism ? Option.some(deps.config.determinism) : Option.none(),
    })
    const log = createErrorLog()
    const page = yield* Effect.promise(() => context.newPage())
    collectPageErrors(page, log)
    const url = new URL(source.url)
    // A file URL's origin is the string "null"; its requests start with file://.
    const networkQuiet = trackNetwork(page, url.protocol === 'file:' ? 'file://' : url.origin)

    const response = yield* Effect.tryPromise({
      try: () => page.goto(source.url, { waitUntil: 'load', timeout: renderTimeoutMs }),
      catch: (error) =>
        String(error).includes('Timeout')
          ? new SourceTimedOutError({
              source,
              waitedMs: renderTimeoutMs,
              waitedFor: 'load',
              consoleErrors: [...log.errors],
            })
          : new SourceRenderFailedError({ source, reason: `could not load the page (${firstLine(error)})` }),
    })

    if (response !== null && response.status() >= 400) {
      return yield* new SourceRenderFailedError({ source, reason: `the server answered ${response.status()}` })
    }

    yield* Effect.promise(networkQuiet)
    yield* deps.runtime.injectRuntime(page)

    if (options.settle) yield* settlePage(page)

    return { page, context, source, variant, consoleErrors: log.errors } satisfies ReadyPage
  })
