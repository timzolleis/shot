import { Cause, Effect } from 'effect'

/** What a project's hook or flow step may return: a value, a Promise, or an Effect. Projects need not learn Effect. */
export type Hook<A> = A | Promise<A> | Effect.Effect<A, unknown>

export const messageFromUnknown = (error: unknown): string => {
  if (error instanceof Error) return (error.message.split('\n')[0] ?? '').replace(/^\w+\.\w+: /, '')

  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }

  return String(error)
}

/** Runs a hook once; a throw, a rejection or a failed Effect becomes `onError(message)`. */
export const effectFromHook = <A, E>(
  evaluate: () => Hook<A>,
  onError: (message: string) => E,
): Effect.Effect<A, E> =>
  Effect.suspend(() => {
    let returned: Hook<A>

    try {
      returned = evaluate()
    } catch (error) {
      return Effect.fail(onError(messageFromUnknown(error)))
    }

    if (Effect.isEffect(returned)) {
      return (returned as Effect.Effect<A, unknown>).pipe(
        Effect.catchCause((cause) => Effect.fail(onError(messageFromUnknown(Cause.squash(cause))))),
      )
    }

    return Effect.tryPromise({
      try: () => Promise.resolve(returned as A | Promise<A>),
      catch: (error) => onError(messageFromUnknown(error)),
    })
  })

