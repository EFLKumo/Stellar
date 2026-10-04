import { toast } from "@workspace/ui/components/toast"
import { Context, Data, Effect, Layer } from "effect"
import { useCallback, useEffect, useRef, useState } from "react"
import { authClient } from "@/lib/auth-client"
import type { CommandMap, CommandName } from "@/shared/contracts"

export class ClientError extends Data.TaggedError("ClientError")<{
  message: string
  status?: number
}> {}

class ApiClient extends Context.Service<
  ApiClient,
  {
    readonly command: <K extends CommandName>(
      command: { action: K } & CommandMap[K]["input"],
    ) => Effect.Effect<CommandMap[K]["output"], ClientError>
  }
>()("stellar/ApiClient") {}

const ClientLive = Layer.succeed(ApiClient, {
  command: <K extends CommandName>(
    command: { action: K } & CommandMap[K]["input"],
  ) =>
    Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch("/api/app", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(command),
          signal,
        })
        const result = await response.json()
        if (!response.ok)
          throw new ClientError({
            message:
              typeof result.error === "string"
                ? result.error
                : "The request failed.",
            status: response.status,
          })
        return result as CommandMap[K]["output"]
      },
      catch: (error) =>
        error instanceof ClientError
          ? error
          : new ClientError({
              message:
                error instanceof Error
                  ? error.message
                  : "Cannot connect to Stellar.",
            }),
    }),
})

export const api = <K extends CommandName>(
  command: { action: K } & CommandMap[K]["input"],
) =>
  Effect.gen(function* () {
    const client = yield* ApiClient
    return yield* client.command(command)
  })

export const signIn = (identifier: string, password: string) =>
  Effect.tryPromise({
    try: async (signal) => {
      const result = identifier.includes("@")
        ? await authClient.signIn.email({
            email: identifier,
            password,
            fetchOptions: { signal },
          })
        : await authClient.signIn.username({
            username: identifier,
            password,
            fetchOptions: { signal },
          })
      if (result.error)
        throw new ClientError({
          message: result.error.message ?? "Cannot sign in.",
          status: result.error.status,
        })
    },
    catch: (error) =>
      error instanceof ClientError
        ? error
        : new ClientError({ message: "Cannot sign in. Try again." }),
  })

export const signOut = Effect.tryPromise({
  try: async (signal) => {
    const result = await authClient.signOut({ fetchOptions: { signal } })
    if (result.error)
      throw new ClientError({
        message: result.error.message ?? "Cannot sign out.",
      })
  },
  catch: () => new ClientError({ message: "Cannot sign out. Try again." }),
})

export function useOperation() {
  const controllers = useRef(new Set<AbortController>())
  const mounted = useRef(true)
  const [pending, setPending] = useState(0)
  useEffect(() => {
    mounted.current = true
    const active = controllers.current
    return () => {
      mounted.current = false
      for (const controller of active) controller.abort()
      active.clear()
    }
  }, [])
  const run = useCallback(
    <A>(
      effect: Effect.Effect<A, ClientError, ApiClient>,
      onSuccess?: (result: A) => void,
      onError?: (error: ClientError) => void,
    ) => {
      const controller = new AbortController()
      controllers.current.add(controller)
      setPending(controllers.current.size)
      const task = effect.pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (!controller.signal.aborted) onSuccess?.(result)
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            if (controller.signal.aborted) return
            if (onError) onError(error)
            else
              toast.add({
                title: "Request failed",
                description: error.message,
                type: "error",
              })
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            controllers.current.delete(controller)
            if (mounted.current) setPending(controllers.current.size)
          }),
        ),
      )
      void Effect.runPromise(task.pipe(Effect.provide(ClientLive)), {
        signal: controller.signal,
      }).catch((error: unknown) => {
        if (!controller.signal.aborted)
          toast.add({
            title: "Request failed",
            description: error instanceof Error ? error.message : "Try again.",
            type: "error",
          })
      })
      return () => controller.abort()
    },
    [],
  )
  return { run, busy: pending > 0 }
}
