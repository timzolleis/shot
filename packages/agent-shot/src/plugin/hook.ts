import { Cause, Effect, Option, Schema } from 'effect'

/**
 * What a project's hook, flow step or plugin may return: a value, a Promise, or an Effect. Projects need not learn
 * Effect.
 */
export type Hook<A, E = unknown, R = never> = A | Promise<A> | Effect.Effect<A, E, R>

/** Thrown values that are not `Error`s but carry a message: a failed Effect's error, a library's plain object. */
const decodeMessageCarrier = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }))

export const messageFromCause = (cause: unknown): string => {
  if (cause instanceof Error) return (cause.message.split('\n')[0] ?? '').replace(/^\w+\.\w+: /, '')

  return Option.match(decodeMessageCarrier(cause), { onNone: () => String(cause), onSome: ({ message }) => message })
}

/** Runs a hook once; a throw, a rejection or a failed Effect becomes `onError(message)`. */
export const effectFromHook = <A, E>(evaluate: () => Hook<A>, onError: (message: string) => E): Effect.Effect<A, E> =>
  Effect.suspend(() => {
    let returned: Hook<A>

    try {
      returned = evaluate()
    } catch (error) {
      return Effect.fail(onError(messageFromCause(error)))
    }

    if (Effect.isEffect(returned)) {
      return returned.pipe(Effect.catchCause((cause) => Effect.fail(onError(messageFromCause(Cause.squash(cause))))))
    }

    return Effect.tryPromise({
      try: () => Promise.resolve(returned),
      catch: (error) => onError(messageFromCause(error)),
    })
  })

/**
 * Runs a plugin's hook: an Effect keeps its typed errors and needs; a throw or a rejection becomes `onError(message)`.
 */
export const effectFromPluginHook = <A, E = never, R = never, F = never>(
  evaluate: () => Hook<A, E, R>,
  onError: (message: string) => F,
): Effect.Effect<A, E | F, R> =>
  Effect.suspend((): Effect.Effect<A, E | F, R> => {
    let returned: Hook<A, E, R>

    try {
      returned = evaluate()
    } catch (error) {
      return Effect.fail(onError(messageFromCause(error)))
    }

    if (Effect.isEffect(returned)) return returned

    return Effect.tryPromise({
      try: () => Promise.resolve(returned),
      catch: (error) => onError(messageFromCause(error)),
    })
  })
