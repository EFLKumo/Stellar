import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin, username } from "better-auth/plugins"
import { Context, Effect, Layer, Redacted } from "effect"
import type { UserView } from "../shared/contracts"
import { AppConfig } from "./config"
import { Database } from "./database"
import { AppError } from "./errors"
import * as schema from "./schema"

const makeAuth = Effect.gen(function* () {
  const { db } = yield* Database
  const config = yield* AppConfig
  const auth = betterAuth({
    appName: "Stellar",
    baseURL: config.baseURL,
    secret: Redacted.value(config.authSecret),
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
    },
    plugins: [
      admin(),
      username({ minUsernameLength: 3, maxUsernameLength: 32 }),
    ],
    trustedOrigins: [new URL(config.baseURL).origin],
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, window: 60, max: 60 },
    disabledPaths: ["/sign-up/email", "/admin/impersonate-user"],
  })
  const requireUser = Effect.fn("auth.requireUser")(function* (
    headers: Headers,
  ) {
    const current = yield* Effect.tryPromise({
      try: () => auth.api.getSession({ headers }),
      catch: (cause) =>
        new AppError({
          message: "The session check failed.",
          status: 503,
          cause,
        }),
    }).pipe(Effect.uninterruptible)
    if (!current || current.user.banned)
      return yield* new AppError({
        message: "Sign in to continue.",
        status: 401,
      })

    return {
      id: current.user.id,
      name: current.user.name,
      email: current.user.email,
      username: current.user.username ?? null,
      role: current.user.role ?? "user",
    } satisfies UserView
  })
  const handle = Effect.fn("auth.handle")((request: Request) =>
    Effect.tryPromise({
      try: () => auth.handler(request),
      catch: (cause) =>
        new AppError({
          message: "The authentication request failed.",
          status: 500,
          cause,
        }),
    }).pipe(Effect.uninterruptible),
  )
  const createUser = Effect.fn("auth.createUser")(
    (input: Parameters<typeof auth.api.createUser>[0]) =>
      Effect.tryPromise({
        try: () => auth.api.createUser(input),
        catch: (cause) =>
          new AppError({
            message:
              "The user could not be created. Check the email and username.",
            status: 400,
            cause,
          }),
      }).pipe(Effect.uninterruptible),
  )
  return { handle, createUser, requireUser }
})
export class Auth extends Context.Service<
  Auth,
  Effect.Success<typeof makeAuth>
>()("stellar/Auth") {
  static readonly layer = Layer.effect(Auth, makeAuth)
}
