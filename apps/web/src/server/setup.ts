import { fileURLToPath } from "node:url"
import { NodeRuntime } from "@effect/platform-node"
import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { Config, Effect, Layer, Redacted } from "effect"
import { Auth } from "./auth"
import { AppConfig } from "./config"
import { Database } from "./database"
import { AppError } from "./errors"
import { user } from "./schema"

const databaseLive = Database.layer.pipe(Layer.provideMerge(AppConfig.layer))
const setupLive = Auth.layer.pipe(Layer.provideMerge(databaseLive))
const setup = Effect.gen(function* () {
  const { client, db, query } = yield* Database
  const { createUser } = yield* Auth
  yield* Effect.acquireUseRelease(
    query(() => client.reserve()),
    (reserved) =>
      Effect.gen(function* () {
        yield* query(() => reserved`select pg_advisory_lock(73683512)`)
        yield* Effect.gen(function* () {
          yield* query(() =>
            migrate(db, {
              migrationsFolder: fileURLToPath(
                new URL("../../drizzle", import.meta.url),
              ),
            }),
          )
          const [existing] = yield* query(() =>
            db
              .select({ id: user.id })
              .from(user)
              .where(eq(user.role, "admin"))
              .limit(1),
          )
          if (existing) return
          const email = yield* Config.String("STELLAR_ADMIN_EMAIL")
          const username = yield* Config.String("STELLAR_ADMIN_USERNAME")
          const password = yield* Config.Redacted("STELLAR_ADMIN_PASSWORD")
          if (
            Redacted.value(password).length < 12 ||
            !/^[a-z0-9_]{3,32}$/.test(username)
          )
            return yield* new AppError({
              message:
                "Set a password with at least 12 characters and a valid admin username.",
              status: 500,
            })
          yield* createUser({
            body: {
              email,
              password: Redacted.value(password),
              name: "Administrator",
              role: "admin",
              data: { username, displayUsername: username },
            },
          })
          yield* Effect.log("The administrator is ready.")
        }).pipe(
          Effect.ensuring(
            query(() => reserved`select pg_advisory_unlock(73683512)`).pipe(
              Effect.orDie,
            ),
          ),
        )
      }),
    (reserved) => Effect.sync(() => reserved.release()),
  )
  yield* Effect.log("The database is ready.")
})
NodeRuntime.runMain(setup.pipe(Effect.provide(setupLive)))
