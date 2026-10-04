import { and, desc, eq, exists, ilike, or, sql } from "drizzle-orm"
import { Effect } from "effect"
import type {
  FeedDetail,
  FeedView,
  ProfileView,
  SubscriptionView,
  UserView,
} from "../shared/contracts"
import { canonicalUrl, extractArticle, validatePublicUrl } from "./content"
import { Database } from "./database"
import { AppError } from "./errors"
import {
  comments,
  feedStates,
  feeds,
  forwards,
  profiles,
  subscriptions,
  user,
} from "./schema"

const visibleTo = (userId: string) =>
  or(eq(feeds.authorId, userId), eq(feeds.isPublic, true))
const feedSelection = {
  id: feeds.id,
  title: feeds.title,
  url: feeds.url,
  content: feeds.content,
  summary: sql<
    string | null
  >`coalesce(${feedStates.summary}, ${feeds.summary})`,
  translation: feedStates.translation,
  language: feedStates.language,
  authorId: feeds.authorId,
  authorName: user.name,
  kind: feeds.kind,
  origin: sql<
    "user" | "ai"
  >`case when ${feedStates.aiSubmitted} then 'ai' else ${feeds.origin} end`,
  isPublic: feeds.isPublic,
  createdAt: feeds.createdAt,
  interested: feedStates.interested,
  saved: sql<boolean>`coalesce(${feedStates.saved}, false)`,
  commentCount: sql<number>`(select count(*)::int from ${comments} where ${comments.feedId} = ${feeds.id})`,
}
const serializeFeed = (
  row: Omit<FeedView, "createdAt"> & { createdAt: Date },
): FeedView => ({ ...row, createdAt: row.createdAt.toISOString() })
export const listFeeds = Effect.fn("feeds.list")(function* (
  userId: string,
  view: "all" | "public" | "saved" | "ai" = "all",
  queryText = "",
) {
  const { db, query } = yield* Database
  const received = exists(
    db
      .select({ id: forwards.feedId })
      .from(forwards)
      .where(and(eq(forwards.feedId, feeds.id), eq(forwards.toUserId, userId))),
  )
  const viewFilter =
    view === "public"
      ? eq(feeds.isPublic, true)
      : view === "saved"
        ? eq(feedStates.saved, true)
        : view === "ai"
          ? or(
              and(eq(feeds.authorId, userId), eq(feeds.origin, "ai")),
              eq(feedStates.aiSubmitted, true),
            )
          : or(
              eq(feeds.authorId, userId),
              received,
              eq(feedStates.aiSubmitted, true),
            )
  const search = queryText.trim()
    ? or(
        ilike(feeds.title, `%${queryText.trim()}%`),
        ilike(feeds.content, `%${queryText.trim()}%`),
      )
    : undefined
  const rows = yield* query(() =>
    db
      .select(feedSelection)
      .from(feeds)
      .innerJoin(user, eq(user.id, feeds.authorId))
      .leftJoin(
        feedStates,
        and(eq(feedStates.feedId, feeds.id), eq(feedStates.userId, userId)),
      )
      .where(and(visibleTo(userId), viewFilter, search))
      .orderBy(desc(feeds.createdAt), desc(feeds.id))
      .limit(100),
  )
  return rows.map(serializeFeed)
})
export const getFeed = Effect.fn("feeds.get")(function* (
  userId: string,
  id: string,
) {
  const { db, query } = yield* Database
  const rows = yield* query(() =>
    db
      .select(feedSelection)
      .from(feeds)
      .innerJoin(user, eq(user.id, feeds.authorId))
      .leftJoin(
        feedStates,
        and(eq(feedStates.feedId, feeds.id), eq(feedStates.userId, userId)),
      )
      .where(and(eq(feeds.id, id), visibleTo(userId)))
      .limit(1),
  )
  const row = rows[0]
  if (!row)
    return yield* new AppError({
      message: "The feed was not found.",
      status: 404,
    })

  const replies = row.isPublic
    ? yield* query(() =>
        db
          .select({
            id: comments.id,
            authorName: user.name,
            content: comments.content,
            createdAt: comments.createdAt,
          })
          .from(comments)
          .innerJoin(user, eq(user.id, comments.authorId))
          .where(eq(comments.feedId, id))
          .orderBy(comments.createdAt)
          .limit(200),
      )
    : []
  return {
    ...serializeFeed(row),
    comments: replies.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  } satisfies FeedDetail
})
export const submitFeed = Effect.fn("feeds.submit")(function* (
  userId: string,
  input: {
    url?: string
    content?: string
    title?: string
    origin?: "user" | "ai"
    summary?: string
  },
  preparedArticle?: Effect.Success<ReturnType<typeof extractArticle>>,
) {
  const { db, query } = yield* Database
  let url: string | null = null
  let content = input.content?.trim() ?? ""
  let title = input.title?.trim() ?? ""
  const findExisting = (targetUrl: string) =>
    query(() =>
      db
        .select({ id: feeds.id })
        .from(feeds)
        .where(
          and(
            eq(feeds.url, targetUrl),
            or(eq(feeds.isPublic, true), eq(feeds.authorId, userId)),
          ),
        )
        .orderBy(desc(feeds.isPublic))
        .limit(1),
    )
  if (input.url) {
    url = yield* Effect.try({
      try: () => canonicalUrl(input.url ?? ""),
      catch: (cause) =>
        cause instanceof AppError
          ? cause
          : new AppError({ message: "Enter a valid URL.", status: 400, cause }),
    })
    const existing = (yield* findExisting(url))[0]
    if (existing) return { id: existing.id, duplicate: true }
    const article = preparedArticle ?? (yield* extractArticle(url))
    url = article.url
    content = article.content
    title ||= article.title
    const resolved = (yield* findExisting(url))[0]
    if (resolved) return { id: resolved.id, duplicate: true }
  } else if (!content) {
    return yield* new AppError({
      message: "Enter a URL or Markdown text.",
      status: 400,
    })
  }
  if (content.length > 60_000 || title.length > 300)
    return yield* new AppError({
      message: "The feed exceeds the size limit.",
      status: 400,
    })

  title ||=
    content
      .split("\n")
      .find((line) => line.trim())
      ?.replace(/^#+\s*/, "")
      .slice(0, 120) || "Untitled feed"
  const id = crypto.randomUUID()
  return yield* query(() =>
    db.transaction(async (tx) => {
      if (url) {
        await tx.execute(sql`select pg_advisory_xact_lock(73683511)`)
        const [existing] = await tx
          .select({ id: feeds.id })
          .from(feeds)
          .where(
            and(
              eq(feeds.url, url),
              or(eq(feeds.isPublic, true), eq(feeds.authorId, userId)),
            ),
          )
          .orderBy(desc(feeds.isPublic))
          .limit(1)
        if (existing) return { id: existing.id, duplicate: true }
      }
      await tx.insert(feeds).values({
        id,
        authorId: userId,
        title,
        url,
        content,
        kind: url ? "link" : "markdown",
        origin: input.origin ?? "user",
        summary: input.summary ?? null,
      })
      return { id, duplicate: false }
    }),
  )
})
export const forwardFeed = Effect.fn("feeds.forward")(function* (
  userId: string,
  id: string,
  toUserId: string,
) {
  yield* getFeed(userId, id)
  const { db, query } = yield* Database
  const recipient = yield* query(() =>
    db
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          eq(user.id, toUserId),
          or(eq(user.banned, false), sql`${user.banned} is null`),
        ),
      )
      .limit(1),
  )
  if (!recipient[0] || toUserId === userId)
    return yield* new AppError({
      message: "Select another active user.",
      status: 400,
    })

  const targetId = yield* query(() =>
    db.transaction(async (tx) => {
      // Serialize publication so a duplicate public URL always has one target.
      await tx.execute(sql`select pg_advisory_xact_lock(73683511)`)
      const [source] = await tx
        .select()
        .from(feeds)
        .where(eq(feeds.id, id))
        .for("update")
      if (!source || (!source.isPublic && source.authorId !== userId))
        throw new AppError({ message: "The feed was not found.", status: 404 })
      const [existing] = source.url
        ? await tx
            .select({ id: feeds.id })
            .from(feeds)
            .where(and(eq(feeds.url, source.url), eq(feeds.isPublic, true)))
            .limit(1)
        : []
      const publicId = existing?.id ?? id
      if (!existing)
        await tx.update(feeds).set({ isPublic: true }).where(eq(feeds.id, id))
      await tx
        .insert(forwards)
        .values({ feedId: publicId, fromUserId: userId, toUserId })
        .onConflictDoNothing()
      return publicId
    }),
  )
  return { id: targetId }
})
export const comment = Effect.fn("feeds.comment")(function* (
  userId: string,
  id: string,
  content: string,
) {
  const feed = yield* getFeed(userId, id)
  if (!feed.isPublic)
    return yield* new AppError({
      message: "Comments are available on public feeds.",
      status: 403,
    })

  const text = content.trim()
  if (!text || text.length > 5_000)
    return yield* new AppError({
      message: "Enter a comment with 1 to 5000 characters.",
      status: 400,
    })

  const { db, query } = yield* Database
  const commentId = crypto.randomUUID()
  yield* query(() =>
    db
      .insert(comments)
      .values({ id: commentId, feedId: id, authorId: userId, content: text }),
  )
  return { id: commentId }
})
export const saveFeed = Effect.fn("feeds.save")(function* (
  userId: string,
  id: string,
  saved: boolean,
) {
  yield* getFeed(userId, id)
  const { db, query } = yield* Database
  yield* query(() =>
    db
      .insert(feedStates)
      .values({ userId, feedId: id, saved })
      .onConflictDoUpdate({
        target: [feedStates.userId, feedStates.feedId],
        set: { saved, updatedAt: sql`now()` },
      }),
  )
  return { ok: true as const }
})
export const feedback = Effect.fn("feeds.feedback")(function* (
  userId: string,
  id: string,
  interested: boolean,
) {
  const feed = yield* getFeed(userId, id)
  if (feed.origin !== "ai")
    return yield* new AppError({
      message: "Use feedback on AI feeds.",
      status: 400,
    })

  const { db, query } = yield* Database
  yield* query(() =>
    db.transaction(async (tx) => {
      await tx
        .insert(feedStates)
        .values({ userId, feedId: id, interested })
        .onConflictDoUpdate({
          target: [feedStates.userId, feedStates.feedId],
          set: { interested, updatedAt: sql`now()` },
        })
      await tx
        .insert(profiles)
        .values({ userId, version: 1 })
        .onConflictDoUpdate({
          target: profiles.userId,
          set: { version: sql`${profiles.version} + 1`, updatedAt: sql`now()` },
        })
    }),
  )
  return { ok: true as const }
})
export const getProfile = Effect.fn("profile.get")(function* (userId: string) {
  const { db, query } = yield* Database
  const [profile] = yield* query(() =>
    db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1),
  )
  return {
    preferences: profile?.preferences ?? "",
    learnedPreferences: profile?.learnedPreferences ?? "",
  } satisfies ProfileView
})
export const updatePreferences = Effect.fn("profile.update")(function* (
  userId: string,
  preferences: string,
) {
  if (preferences.length > 8_000)
    return yield* new AppError({
      message: "Preferences exceed 8000 characters.",
      status: 400,
    })

  const { db, query } = yield* Database
  yield* query(() =>
    db
      .insert(profiles)
      .values({ userId, preferences, version: 1 })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: {
          preferences,
          version: sql`${profiles.version} + 1`,
          updatedAt: sql`now()`,
        },
      }),
  )
  return yield* getProfile(userId)
})
export const listSubscriptions = Effect.fn("rss.list")(function* (
  userId: string,
) {
  const { db, query } = yield* Database
  const rows = yield* query(() =>
    db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(desc(subscriptions.createdAt)),
  )
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    title: r.title,
    enabled: r.enabled,
    lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
    lastError: r.lastError,
  })) satisfies SubscriptionView[]
})
export const subscribe = Effect.fn("rss.subscribe")(function* (
  userId: string,
  url: string,
  title = "",
) {
  const validated = yield* validatePublicUrl(url)
  const canonical = validated.url.toString()
  const { db, query } = yield* Database
  const id = crypto.randomUUID()
  yield* query(() =>
    db
      .insert(subscriptions)
      .values({
        id,
        userId,
        url: canonical,
        title: title.trim().slice(0, 300) || validated.url.hostname,
      })
      .onConflictDoNothing(),
  )
  const [sub] = yield* query(() =>
    db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(eq(subscriptions.userId, userId), eq(subscriptions.url, canonical)),
      )
      .limit(1),
  )
  if (!sub)
    return yield* new AppError({
      message: "The subscription could not be created.",
      status: 503,
    })

  return sub
})
export const updateSubscription = Effect.fn("rss.update")(function* (
  userId: string,
  id: string,
  enabled: boolean,
) {
  const { db, query } = yield* Database
  const rows = yield* query(() =>
    db
      .update(subscriptions)
      .set({ enabled, nextPollAt: sql`now()` })
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)))
      .returning({ id: subscriptions.id }),
  )
  if (!rows[0])
    return yield* new AppError({
      message: "The subscription was not found.",
      status: 404,
    })

  return { ok: true as const }
})
export const unsubscribe = Effect.fn("rss.unsubscribe")(function* (
  userId: string,
  id: string,
) {
  const { db, query } = yield* Database
  const rows = yield* query(() =>
    db
      .delete(subscriptions)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)))
      .returning({ id: subscriptions.id }),
  )
  if (!rows[0])
    return yield* new AppError({
      message: "The subscription was not found.",
      status: 404,
    })

  return { ok: true as const }
})
export const listDirectory = Effect.fn("users.directory")(function* () {
  const { db, query } = yield* Database
  return yield* query(() =>
    db
      .select({ id: user.id, name: user.name, username: user.username })
      .from(user)
      .where(or(eq(user.banned, false), sql`${user.banned} is null`))
      .orderBy(user.name)
      .limit(500),
  )
})
export const listUsers = Effect.fn("users.list")(function* (actor: UserView) {
  if (actor.role !== "admin")
    return yield* new AppError({
      message: "Administrator access is required.",
      status: 403,
    })

  const { db, query } = yield* Database
  return yield* query(() =>
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        role: user.role,
      })
      .from(user)
      .orderBy(user.name)
      .limit(500),
  )
})
