import { Config, Context, Effect, Layer, Redacted, Schema } from "effect"
import { AppError } from "./errors"

export const ModelSpec = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  provider: Schema.Literals(["google", "openai", "anthropic"]),
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
})
export type ModelSpec = typeof ModelSpec.Type
const loadConfig = Effect.gen(function* () {
  const rawModels = yield* Config.String("AI_MODELS").pipe(
    Config.withDefault(
      '[{"id":"gemini-flash","name":"Gemini Flash","provider":"google","model":"gemini-flash-latest"}]',
    ),
  )
  const models = yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Array(ModelSpec)),
  )(rawModels).pipe(
    Effect.mapError(
      (cause) =>
        new AppError({
          message: "AI_MODELS must contain a JSON array of valid models.",
          status: 500,
          cause,
        }),
    ),
  )
  if (
    models.length === 0 ||
    new Set(models.map((m) => m.id)).size !== models.length
  )
    return yield* new AppError({
      message: "AI_MODELS must contain unique model IDs.",
      status: 500,
    })

  const databaseUrl = yield* Config.Redacted("DATABASE_URL")
  const authSecret = yield* Config.Redacted("BETTER_AUTH_SECRET")
  if (Redacted.value(authSecret).length < 32)
    return yield* new AppError({
      message: "BETTER_AUTH_SECRET must contain at least 32 characters.",
      status: 500,
    })

  const baseURL = yield* Config.String("BETTER_AUTH_URL").pipe(
    Config.withDefault("http://localhost:3000"),
  )
  const googleApiKey = yield* Config.Redacted(
    "GOOGLE_GENERATIVE_AI_API_KEY",
  ).pipe(Config.withDefault(Redacted.make("")))
  const openaiApiKey = yield* Config.Redacted("OPENAI_API_KEY").pipe(
    Config.withDefault(Redacted.make("")),
  )
  const anthropicApiKey = yield* Config.Redacted("ANTHROPIC_API_KEY").pipe(
    Config.withDefault(Redacted.make("")),
  )
  const rssPollSeconds = yield* Config.Int("RSS_POLL_SECONDS").pipe(
    Config.withDefault(900),
  )
  const rssConcurrency = yield* Config.Int("RSS_CONCURRENCY").pipe(
    Config.withDefault(2),
  )
  return {
    databaseUrl,
    authSecret,
    baseURL,
    models,
    googleApiKey,
    openaiApiKey,
    anthropicApiKey,
    rssPollSeconds: Math.max(60, rssPollSeconds),
    rssConcurrency: Math.max(1, Math.min(8, rssConcurrency)),
  }
})
export class AppConfig extends Context.Service<
  AppConfig,
  Effect.Success<typeof loadConfig>
>()("stellar/AppConfig") {
  static readonly layer = Layer.effect(AppConfig, loadConfig)
}
