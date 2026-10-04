import { and, desc, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { AppData, Command, UserView } from "../shared/contracts"
import { Ai } from "./ai"
import { Auth } from "./auth"
import { AppConfig } from "./config"
import { Database } from "./database"
import * as domain from "./domain"
import { AppError } from "./errors"
import { threads } from "./schema"

const bounded = (min: number, max: number) =>
  Schema.String.check(Schema.isMinLength(min), Schema.isMaxLength(max))
const id = bounded(1, 100)
const url = bounded(1, 2048)
const optionalTitle = Schema.optionalKey(bounded(0, 300))
export const CommandSchema = Schema.Union([
  Schema.Struct({ action: Schema.Literal("bootstrap") }),
  Schema.Struct({
    action: Schema.Literal("listFeeds"),
    view: Schema.Literals(["all", "public", "saved", "ai"]),
    query: Schema.optionalKey(bounded(0, 200)),
  }),
  Schema.Struct({ action: Schema.Literal("getFeed"), id }),
  Schema.Struct({
    action: Schema.Literal("submitFeed"),
    url: Schema.optionalKey(url),
    content: Schema.optionalKey(bounded(0, 60_000)),
    title: optionalTitle,
  }),
  Schema.Struct({ action: Schema.Literal("forwardFeed"), id, toUserId: id }),
  Schema.Struct({
    action: Schema.Literal("comment"),
    id,
    content: bounded(1, 5000),
  }),
  Schema.Struct({
    action: Schema.Literal("feedback"),
    id,
    interested: Schema.Boolean,
  }),
  Schema.Struct({
    action: Schema.Literal("saveFeed"),
    id,
    saved: Schema.Boolean,
  }),
  Schema.Struct({ action: Schema.Literal("summarize"), id, modelId: id }),
  Schema.Struct({
    action: Schema.Literal("translate"),
    id,
    modelId: id,
    language: bounded(1, 80),
  }),
  Schema.Struct({
    action: Schema.Literal("subscribe"),
    url,
    title: optionalTitle,
  }),
  Schema.Struct({
    action: Schema.Literal("updateSubscription"),
    id,
    enabled: Schema.Boolean,
  }),
  Schema.Struct({ action: Schema.Literal("unsubscribe"), id }),
  Schema.Struct({
    action: Schema.Literal("updatePreferences"),
    preferences: bounded(0, 8000),
  }),
  Schema.Struct({ action: Schema.Literal("listUsers") }),
  Schema.Struct({
    action: Schema.Literal("createUser"),
    email: bounded(3, 254).check(
      Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
    ),
    username: bounded(3, 32).check(Schema.isPattern(/^[a-z0-9_]+$/)),
    name: bounded(1, 100),
    password: bounded(12, 128),
    role: Schema.Literals(["user", "admin"]),
  }),
  Schema.Struct({ action: Schema.Literal("createThread") }),
  Schema.Struct({ action: Schema.Literal("getThread"), id }),
  Schema.Struct({ action: Schema.Literal("deleteThread"), id }),
])
export const executeCommand = Effect.fn("app.command")(function* (
  actor: UserView,
  command: Command,
  headers: Headers,
) {
  const userId = actor.id
  switch (command.action) {
    case "bootstrap": {
      const config = yield* AppConfig
      const { db, query } = yield* Database
      const results = yield* Effect.all(
        {
          feeds: domain.listFeeds(userId),
          subscriptions: domain.listSubscriptions(userId),
          profile: domain.getProfile(userId),
          users: domain.listDirectory(),
          threads: query(() =>
            db
              .select({
                id: threads.id,
                title: threads.title,
                updatedAt: threads.updatedAt,
              })
              .from(threads)
              .where(eq(threads.userId, userId))
              .orderBy(desc(threads.updatedAt))
              .limit(100),
          ),
        },
        { concurrency: 4 },
      )
      return {
        ...results,
        user: actor,
        models: config.models.map(({ id, name, provider }) => ({
          id,
          name,
          provider,
        })),
        threads: results.threads.map((t) => ({
          ...t,
          updatedAt: t.updatedAt.toISOString(),
        })),
      } satisfies AppData
    }
    case "listFeeds":
      return yield* domain.listFeeds(userId, command.view, command.query)
    case "getFeed":
      return yield* domain.getFeed(userId, command.id)
    case "submitFeed":
      return yield* domain.submitFeed(userId, command)
    case "forwardFeed":
      return yield* domain.forwardFeed(userId, command.id, command.toUserId)
    case "comment":
      return yield* domain.comment(userId, command.id, command.content)
    case "feedback": {
      const result = yield* domain.feedback(
        userId,
        command.id,
        command.interested,
      )
      // Feedback is durable even when the provider is unavailable. RSS retries refinement.
      const ai = yield* Ai
      yield* ai.refineProfile(userId).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Profile refinement will retry.", {
            userId,
            error: error.message,
          }),
        ),
      )
      return result
    }
    case "saveFeed":
      return yield* domain.saveFeed(userId, command.id, command.saved)
    case "summarize":
      return yield* (yield* Ai).summarize(userId, command.id, command.modelId)
    case "translate":
      return yield* (yield* Ai).translate(
        userId,
        command.id,
        command.modelId,
        command.language,
      )
    case "subscribe":
      return yield* domain.subscribe(userId, command.url, command.title)
    case "updateSubscription":
      return yield* domain.updateSubscription(
        userId,
        command.id,
        command.enabled,
      )
    case "unsubscribe":
      return yield* domain.unsubscribe(userId, command.id)
    case "updatePreferences":
      return yield* domain.updatePreferences(userId, command.preferences)
    case "listUsers":
      return yield* domain.listUsers(actor)
    case "createUser": {
      if (actor.role !== "admin")
        return yield* new AppError({
          message: "Administrator access is required.",
          status: 403,
        })
      const result = yield* (yield* Auth).createUser({
        headers,
        body: {
          email: command.email,
          password: command.password,
          name: command.name,
          role: command.role,
          data: {
            username: command.username,
            displayUsername: command.username,
          },
        },
      })
      return { id: result.user.id }
    }
    case "createThread": {
      const { db, query } = yield* Database
      const id = crypto.randomUUID()
      const [row] = yield* query(() =>
        db.insert(threads).values({ id, userId }).returning({
          id: threads.id,
          title: threads.title,
          updatedAt: threads.updatedAt,
        }),
      )
      if (!row)
        return yield* new AppError({
          message: "The conversation could not be created.",
          status: 503,
        })
      return { ...row, updatedAt: row.updatedAt.toISOString() }
    }
    case "getThread": {
      const { db, query } = yield* Database
      const [row] = yield* query(() =>
        db
          .select({
            id: threads.id,
            title: threads.title,
            messages: threads.messages,
          })
          .from(threads)
          .where(and(eq(threads.id, command.id), eq(threads.userId, userId)))
          .limit(1),
      )
      if (!row)
        return yield* new AppError({
          message: "The conversation was not found.",
          status: 404,
        })
      return row
    }
    case "deleteThread": {
      const { db, query } = yield* Database
      const rows = yield* query(() =>
        db
          .delete(threads)
          .where(and(eq(threads.id, command.id), eq(threads.userId, userId)))
          .returning({ id: threads.id }),
      )
      if (!rows[0])
        return yield* new AppError({
          message: "The conversation was not found.",
          status: 404,
        })
      return { ok: true as const }
    }
  }
})
