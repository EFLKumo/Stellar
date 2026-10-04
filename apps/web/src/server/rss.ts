import { createHash, randomUUID } from "node:crypto"
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm"
import { Effect } from "effect"
import { parseHTML } from "linkedom"
import Parser from "rss-parser"
import { Ai } from "./ai"
import { AppConfig } from "./config"
import { canonicalUrl, extractArticle, fetchDocument } from "./content"
import { Database } from "./database"
import { submitFeed } from "./domain"
import { AppError } from "./errors"
import { feedStates, profiles, rssItems, subscriptions } from "./schema"

const parser = new Parser<Record<string, never>, Record<string, never>>()
type Subscription = typeof subscriptions.$inferSelect

export const fetchRss = Effect.fn("rss.fetch")(function* (url: string) {
  const source = yield* fetchDocument(
    url,
    "application/rss+xml,application/atom+xml,application/xml,text/xml",
  )
  const feed = yield* Effect.tryPromise({
    try: () => parser.parseString(source.text),
    catch: (cause) =>
      new AppError({
        message: "The RSS or Atom feed could not be read.",
        status: 422,
        cause,
      }),
  })
  return {
    title: (feed.title || new URL(source.url).hostname).slice(0, 300),
    items: feed.items.slice(0, 100).flatMap((item) => {
      try {
        const url = item.link
          ? canonicalUrl(new URL(item.link, source.url).toString())
          : undefined
        const content = (
          item.contentSnippet ||
          parseHTML(item.content || item.summary || "").document.textContent ||
          ""
        )
          .trim()
          .slice(0, 60_000)
        if (!url && !content) return []
        const title = (item.title || "Untitled article").slice(0, 300)
        const itemKey = createHash("sha256")
          .update(item.guid || url || `${title}\n${content}`)
          .digest("hex")
        return [{ itemKey, url, title, content }]
      } catch {
        return []
      }
    }),
  }
})

const pollSubscription = Effect.fn("rss.pollSubscription")(function* (
  subscription: Subscription,
) {
  const { db, query } = yield* Database
  const config = yield* AppConfig
  const ai = yield* Ai
  const token = randomUUID()
  const claim = query(() =>
    db
      .update(subscriptions)
      .set({
        leaseToken: token,
        leaseUntil: new Date(Date.now() + 600_000),
      })
      .where(
        and(
          eq(subscriptions.id, subscription.id),
          eq(subscriptions.enabled, true),
          lte(subscriptions.nextPollAt, sql`now()`),
          or(
            isNull(subscriptions.leaseUntil),
            lte(subscriptions.leaseUntil, sql`now()`),
          ),
        ),
      )
      .returning(),
  )
  const owned = and(
    eq(subscriptions.id, subscription.id),
    eq(subscriptions.leaseToken, token),
  )
  const release = query(() =>
    db
      .update(subscriptions)
      .set({ leaseToken: null, leaseUntil: null })
      .where(owned),
  ).pipe(
    Effect.catch(() =>
      Effect.logWarning("The subscription lease could not be released."),
    ),
  )
  yield* Effect.acquireUseRelease(
    claim,
    (leases) =>
      Effect.gen(function* () {
        if (!leases[0]) return
        const poll = Effect.gen(function* () {
          const feed = yield* fetchRss(subscription.url)
          const seen = yield* query(() =>
            db
              .select({ itemKey: rssItems.itemKey })
              .from(rssItems)
              .where(
                and(
                  eq(rssItems.subscriptionId, subscription.id),
                  inArray(
                    rssItems.itemKey,
                    feed.items.map((item) => item.itemKey),
                  ),
                ),
              ),
          )
          const known = new Set(seen.map((item) => item.itemKey))
          // Each article has a time limit. The lease exceeds the whole poll limit.
          const pending = feed.items
            .filter((item) => !known.has(item.itemKey))
            .slice(0, 5)
          const failures: string[] = []
          yield* Effect.forEach(
            pending,
            (item) =>
              Effect.gen(function* () {
                const [active] = yield* query(() =>
                  db
                    .select({ id: subscriptions.id })
                    .from(subscriptions)
                    .where(and(owned, eq(subscriptions.enabled, true))),
                )
                if (!active) return
                const article = item.url
                  ? yield* extractArticle(item.url)
                  : { title: item.title, content: item.content, url: "" }
                const decision = yield* ai.matchArticle(
                  subscription.userId,
                  article,
                )
                let feedId: string | null = null
                if (decision.matched) {
                  const created = yield* submitFeed(
                    subscription.userId,
                    {
                      url: article.url || undefined,
                      title: article.title,
                      content: article.content,
                      origin: "ai",
                      summary: `${decision.summary}\n\n*Why this matches:* ${decision.reason}`,
                    },
                    article.url ? article : undefined,
                  )
                  feedId = created.id
                  const summary = `${decision.summary}\n\n*Why this matches:* ${decision.reason}`
                  yield* query(() =>
                    db
                      .insert(feedStates)
                      .values({
                        userId: subscription.userId,
                        feedId: created.id,
                        summary,
                        aiSubmitted: true,
                      })
                      .onConflictDoUpdate({
                        target: [feedStates.userId, feedStates.feedId],
                        set: {
                          summary,
                          aiSubmitted: true,
                          updatedAt: new Date(),
                        },
                      }),
                  )
                }
                yield* query(() =>
                  db
                    .insert(rssItems)
                    .values({
                      subscriptionId: subscription.id,
                      itemKey: item.itemKey,
                      matched: decision.matched,
                      feedId,
                    })
                    .onConflictDoNothing(),
                )
              }).pipe(
                Effect.timeout("140 seconds"),
                Effect.catch((error) =>
                  Effect.sync(() => {
                    failures.push(
                      error instanceof AppError
                        ? error.message
                        : "The article check timed out.",
                    )
                  }),
                ),
              ),
            { concurrency: 2, discard: true },
          )
          yield* query(() =>
            db
              .update(subscriptions)
              .set({
                title:
                  subscription.title === new URL(subscription.url).hostname
                    ? feed.title
                    : subscription.title,
                lastCheckedAt: new Date(),
                lastError: failures.length
                  ? `${failures.length} article check(s) failed. ${failures[0]}`
                  : null,
                nextPollAt: new Date(
                  Date.now() +
                    (failures.length
                      ? Math.min(config.rssPollSeconds, 120)
                      : config.rssPollSeconds) *
                      1000,
                ),
              })
              .where(owned),
          )
        })
        yield* poll.pipe(
          Effect.timeout("480 seconds"),
          Effect.catch((error) =>
            query(() =>
              db
                .update(subscriptions)
                .set({
                  lastCheckedAt: new Date(),
                  lastError:
                    error instanceof AppError
                      ? error.message
                      : "The subscription check timed out.",
                  nextPollAt: new Date(
                    Date.now() + Math.min(config.rssPollSeconds, 120) * 1000,
                  ),
                })
                .where(owned),
            ),
          ),
        )
      }),
    (leases) => (leases[0] ? release : Effect.void),
  )
})

export const pollSubscriptions = Effect.gen(function* () {
  const { db, query } = yield* Database
  const config = yield* AppConfig
  const ai = yield* Ai
  const dirty = yield* query(() =>
    db
      .select({ userId: profiles.userId })
      .from(profiles)
      .where(lt(profiles.learnedVersion, profiles.version))
      .orderBy(asc(profiles.updatedAt))
      .limit(20),
  )
  yield* Effect.forEach(
    dirty,
    ({ userId }) =>
      ai
        .refineProfile(userId)
        .pipe(
          Effect.catch(() =>
            Effect.logWarning("The reading profile update will be retried."),
          ),
        ),
    { concurrency: config.rssConcurrency, discard: true },
  )
  const due = yield* query(() =>
    db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.enabled, true),
          lte(subscriptions.nextPollAt, sql`now()`),
          or(
            isNull(subscriptions.leaseUntil),
            lte(subscriptions.leaseUntil, sql`now()`),
          ),
        ),
      )
      .orderBy(asc(subscriptions.nextPollAt))
      .limit(20),
  )
  yield* Effect.forEach(due, pollSubscription, {
    concurrency: config.rssConcurrency,
    discard: true,
  })
})
