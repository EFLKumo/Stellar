import { drizzle } from "drizzle-orm/postgres-js"
import { Context, Effect, Layer, Redacted } from "effect"
import postgres from "postgres"
import { AppConfig } from "./config"
import { AppError } from "./errors"
import * as schema from "./schema"

export const query = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: () => Promise.resolve(operation()),
    catch: (cause) =>
      cause instanceof AppError
        ? cause
        : new AppError({
            message: "The database operation failed.",
            status: 503,
            cause,
          }),
  }).pipe(Effect.uninterruptible)
const connect = Effect.gen(function* () {
  const config = yield* AppConfig
  const client = yield* Effect.acquireRelease(
    Effect.sync(() =>
      postgres(Redacted.value(config.databaseUrl), {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 10,
        connection: { statement_timeout: 15000 },
        onnotice: () => {},
      }),
    ),
    (client) => Effect.promise(() => client.end({ timeout: 5 })),
  )
  return { db: drizzle(client, { schema }), client, query }
})
export class Database extends Context.Service<
  Database,
  Effect.Success<typeof connect>
>()("stellar/Database") {
  static readonly layer = Layer.effect(Database, connect)
}
