import { Cause, Effect, Schema, Stream } from "effect"
import { Ai } from "./ai"
import { Auth } from "./auth"
import { CommandSchema, executeCommand } from "./commands"
import { AppConfig } from "./config"
import { Database } from "./database"
import { AppError } from "./errors"
import { appRuntime } from "./runtime"

const jsonBody = Effect.fn("http.jsonBody")(function* (request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    return yield* new AppError({
      message: "Use a JSON request body.",
      status: 415,
    })
  const origin = request.headers.get("origin")
  const config = yield* AppConfig
  if (origin && origin !== new URL(config.baseURL).origin)
    return yield* new AppError({
      message: "The request origin is not allowed.",
      status: 403,
    })
  if (!request.body)
    return yield* new AppError({
      message: "Use a JSON request body.",
      status: 400,
    })
  const bodyStream = request.body
  const raw = yield* Stream.fromReadableStream({
    evaluate: () => bodyStream,
    onError: (cause) =>
      new AppError({
        message: "The request body could not be read.",
        status: 400,
        cause,
      }),
  }).pipe(
    Stream.decodeText(),
    Stream.runFoldEffect(
      () => "",
      (body, chunk) =>
        body.length + chunk.length > 256_000
          ? Effect.fail(
              new AppError({
                message: "The request exceeds the size limit.",
                status: 413,
              }),
            )
          : Effect.succeed(body + chunk),
    ),
    Effect.mapError((cause) =>
      cause instanceof AppError
        ? cause
        : new AppError({
            message: "The request body could not be read.",
            status: 400,
            cause,
          }),
    ),
  )
  return yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
    raw,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new AppError({
          message: "Enter a valid JSON request.",
          status: 400,
          cause,
        }),
    ),
  )
})
const chatBody = Schema.Struct({
  threadId: Schema.String,
  modelId: Schema.String,
  messages: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(100)),
})
const toResponse = <A>(result: A) =>
  Response.json(result, { headers: { "Cache-Control": "no-store" } })
const runRequest = <E>(
  request: Request,
  effect: Effect.Effect<Response, E, Ai | Auth | AppConfig | Database>,
) =>
  appRuntime.runPromise(
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const error = Cause.findErrorOption(cause)
          if (error._tag === "Some" && error.value instanceof AppError) {
            if (error.value.status >= 500)
              yield* Effect.logWarning("Request failed.", {
                error: error.value.message,
              })
            return Response.json(
              { error: error.value.message },
              {
                status: error.value.status,
                headers: { "Cache-Control": "no-store" },
              },
            )
          }
          yield* Effect.logError("Request failed.", Cause.pretty(cause))
          return Response.json(
            { error: "The request failed. Try again." },
            { status: 500 },
          )
        }),
      ),
    ),
    { signal: request.signal },
  )

export const handleApp = (request: Request) =>
  runRequest(
    request,
    Effect.gen(function* () {
      const actor = yield* (yield* Auth).requireUser(request.headers)
      const raw = yield* jsonBody(request)
      const command = yield* Schema.decodeUnknownEffect(CommandSchema)(
        raw,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new AppError({
              message: "The command contains invalid data.",
              status: 400,
              cause,
            }),
        ),
      )
      return toResponse(yield* executeCommand(actor, command, request.headers))
    }),
  )
export const handleChat = (request: Request) =>
  runRequest(
    request,
    Effect.gen(function* () {
      const actor = yield* (yield* Auth).requireUser(request.headers)
      const raw = yield* jsonBody(request)
      const body = yield* Schema.decodeUnknownEffect(chatBody)(raw).pipe(
        Effect.mapError(
          (cause) =>
            new AppError({
              message: "The chat request contains invalid data.",
              status: 400,
              cause,
            }),
        ),
      )
      return yield* (yield* Ai).chat(
        actor.id,
        body.threadId,
        body.modelId,
        [...body.messages],
        request.signal,
      )
    }),
  )
export const handleAuth = (request: Request) =>
  runRequest(
    request,
    Effect.gen(function* () {
      return yield* (yield* Auth).handle(request)
    }),
  )
export const handleHealth = (request: Request) =>
  runRequest(
    request,
    Effect.gen(function* () {
      const { client, query } = yield* Database
      yield* query(() => client`select 1`)
      return toResponse({ status: "ok" })
    }),
  )
