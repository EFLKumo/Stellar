import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Agent, MockAgent } from "undici"
import { Ai } from "./ai"
import { Database } from "./database"
import { feedback, listFeeds } from "./domain"
import { pollSubscriptions } from "./rss"
import { feedStates, rssItems, subscriptions } from "./schema"
import { databaseTests, testApp } from "./test-support"

const xml = `<rss version="2.0"><channel><title>Research feed</title><link>https://1.1.1.1/</link><description>Research</description><item><guid>accepted</guid><title>Space research</title><link>https://1.1.1.1/accepted</link></item><item><guid>rejected</guid><title>Other research</title><link>https://1.1.1.1/rejected</link></item><item><guid>new</guid><title>New space research</title><link>https://1.1.1.1/new</link></item></channel></rss>`
const html = `<html><head><title>Space research</title></head><body><article><p>${"Useful research and observations about space exploration. ".repeat(30)}</p></article></body></html>`

test(
  "RSS polling filters articles, personalizes existing public feeds, and avoids replay",
  databaseTests,
  async (context) => {
    const app = await testApp()
    context.after(() => app.close())
    const mock = new MockAgent()
    mock.disableNetConnect()
    const remote = mock.get("https://1.1.1.1")
    context.mock.method(
      Agent.prototype,
      "dispatch",
      (...[options, handler]: Parameters<Agent["dispatch"]>) =>
        mock.get(String(options.origin)).dispatch(options, handler),
    )
    context.after(() => mock.close())
    remote
      .intercept({ path: "/rss", method: "GET" })
      .reply(200, xml, { headers: { "content-type": "application/rss+xml" } })
      .persist()
    for (const path of ["/accepted", "/rejected", "/new"])
      remote
        .intercept({ path, method: "GET" })
        .reply(200, html, { headers: { "content-type": "text/html" } })
    const publicId = await app.feed(app.other, {
      url: "https://1.1.1.1/accepted",
      isPublic: true,
      kind: "link",
      summary: "Original public summary",
    })
    const subscriptionId = randomUUID()
    await app.db.insert(subscriptions).values({
      id: subscriptionId,
      userId: app.owner,
      title: "Research",
      url: "https://1.1.1.1/rss",
    })
    let decisions = 0
    const ai = {
      ...app.ai,
      matchArticle: (userId: string, article: { url: string }) =>
        Effect.sync(() => {
          assert.equal(userId, app.owner)
          decisions++
          return {
            matched: !article.url.endsWith("/rejected"),
            summary: "Your research summary",
            reason: "Space preferences",
          }
        }),
    }
    await app.runtime.runPromise(
      pollSubscriptions.pipe(Effect.provideService(Ai, ai)),
    )
    const recommended = await app.runtime.runPromise(listFeeds(app.owner, "ai"))
    const all = await app.runtime.runPromise(listFeeds(app.owner, "all"))
    assert.equal(recommended.length, 2)
    const existing = recommended.find((feed) => feed.id === publicId)
    const created = recommended.find(
      (feed) => feed.url === "https://1.1.1.1/new",
    )
    assert.ok(existing)
    assert.equal(existing.origin, "ai")
    assert.ok(created)
    assert.equal(created.authorId, app.owner)
    assert.equal(created.isPublic, false)
    assert.ok(all.some((feed) => feed.id === publicId))
    assert.ok(existing.summary?.includes("Your research summary"))
    const [state] = await app.db
      .select()
      .from(feedStates)
      .where(eq(feedStates.feedId, publicId))
    assert.equal(state?.aiSubmitted, true)
    assert.equal(state?.userId, app.owner)
    const items = await app.db
      .select()
      .from(rssItems)
      .where(eq(rssItems.subscriptionId, subscriptionId))
    assert.equal(items.length, 3)
    assert.equal(items.filter((item) => item.matched).length, 2)
    const [checked] = await app.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId))
    assert.equal(checked?.leaseToken, null)
    assert.equal(checked?.leaseUntil, null)
    assert.equal(checked?.lastError, null)
    await app.db
      .update(subscriptions)
      .set({ nextPollAt: new Date(0) })
      .where(eq(subscriptions.id, subscriptionId))
    await app.runtime.runPromise(
      pollSubscriptions.pipe(Effect.provideService(Ai, ai)),
    )
    assert.equal(decisions, 3)
    assert.equal(
      (
        await app.db
          .select()
          .from(rssItems)
          .where(eq(rssItems.subscriptionId, subscriptionId))
      ).length,
      3,
    )
    await app.runtime.runPromise(feedback(app.owner, publicId, true))
    const [rated] = await app.db
      .select()
      .from(feedStates)
      .where(eq(feedStates.feedId, publicId))
    assert.equal(rated?.interested, true)
  },
)

test(
  "RSS cancellation immediately after lease acquisition releases the lease",
  databaseTests,
  async (context) => {
    const app = await testApp()
    context.after(() => app.close())
    const id = randomUUID()
    await app.db.insert(subscriptions).values({
      id,
      userId: app.owner,
      title: "Cancellation",
      url: "https://1.1.1.1/rss",
    })
    const controller = new AbortController()
    let claimed = false
    const database = {
      ...app.database,
      query: <A>(operation: () => PromiseLike<A>) =>
        app.database.query(operation).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              if (
                Array.isArray(result) &&
                result.some((row) => row?.id === id && row?.leaseToken)
              ) {
                claimed = true
                controller.abort()
              }
            }),
          ),
        ),
    }
    await assert.rejects(
      app.runtime.runPromise(
        pollSubscriptions.pipe(Effect.provideService(Database, database)),
        { signal: controller.signal },
      ),
    )
    assert.equal(claimed, true)
    const [subscription] = await app.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
    assert.equal(subscription?.leaseToken, null)
    assert.equal(subscription?.leaseUntil, null)
  },
)
