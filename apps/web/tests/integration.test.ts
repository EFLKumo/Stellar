import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, before, describe, it } from "node:test"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { feeds, user } from "../src/server/schema"
import type { AppData, FeedDetail, ProfileView } from "../src/shared/contracts"

const configuredBase = process.env.TEST_BASE_URL
const base = configuredBase?.startsWith("http")
  ? configuredBase
  : `http://${configuredBase ?? "localhost:3000"}`
const origin = new URL(base).origin
const password = "stellar-integration-password-0001"
const suffix = randomUUID().slice(0, 8)
const accounts = [
  {
    username: `test_a_${suffix}`,
    email: `test_a_${suffix}@example.com`,
    name: "Test Alice",
  },
  {
    username: `test_b_${suffix}`,
    email: `test_b_${suffix}@example.com`,
    name: "Test Bob",
  },
]

async function request<T = Record<string, unknown>>(
  path: string,
  body: unknown,
  cookie = "",
) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const bodyText = await response.text()
  let responseBody: unknown
  try {
    responseBody = JSON.parse(bodyText)
  } catch {
    responseBody = { error: bodyText }
  }
  return {
    status: response.status,
    body: responseBody as T,
    cookie: response.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0])
      .join("; "),
  }
}

describe("Stellar HTTP and PostgreSQL integration", {
  skip: !configuredBase,
  concurrency: false,
}, () => {
  let adminCookie = ""
  let aliceCookie = ""
  let bobCookie = ""
  let aliceId = ""
  let bobId = ""
  let privateId = ""
  let publicId = ""
  let threadId = ""
  let client: ReturnType<typeof postgres> | undefined
  const createdAccounts: string[] = []

  before(async () => {
    const databaseUrl =
      process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
    assert.ok(
      databaseUrl,
      "Set TEST_DATABASE_URL or DATABASE_URL for integration tests.",
    )
    assert.ok(
      process.env.STELLAR_ADMIN_USERNAME,
      "Set STELLAR_ADMIN_USERNAME for integration tests.",
    )
    assert.ok(
      process.env.STELLAR_ADMIN_PASSWORD,
      "Set STELLAR_ADMIN_PASSWORD for integration tests.",
    )
    client = postgres(databaseUrl, {
      max: 2,
      connect_timeout: 5,
      idle_timeout: 5,
    })
    const admin = await request("/api/auth/sign-in/username", {
      username: process.env.STELLAR_ADMIN_USERNAME,
      password: process.env.STELLAR_ADMIN_PASSWORD,
    })
    assert.equal(admin.status, 200, JSON.stringify(admin.body))
    assert.ok(admin.cookie)
    adminCookie = admin.cookie
    for (const account of accounts) {
      const created = await request<{ id: string }>(
        "/api/app",
        {
          action: "createUser",
          ...account,
          password,
          role: "user",
        },
        adminCookie,
      )
      assert.equal(created.status, 200, JSON.stringify(created.body))
      createdAccounts.push(created.body.id)
    }
    ;[aliceId, bobId] = createdAccounts
    const alice = await request("/api/auth/sign-in/username", {
      username: accounts[0].username,
      password,
    })
    const bob = await request("/api/auth/sign-in/username", {
      username: accounts[1].username,
      password,
    })
    assert.equal(alice.status, 200)
    assert.equal(bob.status, 200)
    aliceCookie = alice.cookie
    bobCookie = bob.cookie
    assert.ok(aliceCookie && bobCookie)
  })

  after(async () => {
    if (!client) return
    try {
      const db = drizzle(client)
      for (const id of createdAccounts)
        await db.delete(user).where(eq(user.id, id))
    } finally {
      await client.end({ timeout: 5 })
    }
  })

  it("requires authentication and permits account creation only for administrators", async () => {
    const unauthenticated = await request("/api/app", { action: "bootstrap" })
    assert.equal(unauthenticated.status, 401)
    const signup = await request("/api/auth/sign-up/email", {
      email: `signup_${suffix}@example.com`,
      name: "Blocked Signup",
      password,
    })
    assert.ok(signup.status >= 400, JSON.stringify(signup.body))
    const create = await request(
      "/api/app",
      {
        action: "createUser",
        email: `forbidden_${suffix}@example.com`,
        username: `forbidden_${suffix}`,
        name: "Forbidden User",
        password,
        role: "admin",
      },
      bobCookie,
    )
    assert.equal(create.status, 403)
    const list = await request("/api/app", { action: "listUsers" }, bobCookie)
    assert.equal(list.status, 403)
    const emailLogin = await request("/api/auth/sign-in/email", {
      email: accounts[0].email,
      password,
    })
    assert.equal(emailLogin.status, 200)
  })

  it("keeps private feeds and all related operations inaccessible to other users", async () => {
    const created = await request<{ id: string; duplicate: boolean }>(
      "/api/app",
      {
        action: "submitFeed",
        title: `Private ${suffix}`,
        content: "# Private text\nOnly Alice can read this feed.",
      },
      aliceCookie,
    )
    assert.equal(created.status, 200)
    assert.equal(created.body.duplicate, false)
    privateId = created.body.id
    const detail = await request<FeedDetail>(
      "/api/app",
      { action: "getFeed", id: privateId },
      aliceCookie,
    )
    assert.equal(detail.status, 200)
    assert.equal(detail.body.isPublic, false)
    for (const command of [
      { action: "getFeed", id: privateId },
      { action: "comment", id: privateId, content: "Forbidden comment" },
      { action: "saveFeed", id: privateId, saved: true },
      { action: "feedback", id: privateId, interested: true },
      { action: "forwardFeed", id: privateId, toUserId: aliceId },
    ]) {
      const result = await request("/api/app", command, bobCookie)
      assert.equal(result.status, 404, command.action)
    }
  })

  it("publishes forwarded feeds and permits comments on the public feed", async () => {
    const forwarded = await request<{ id: string }>(
      "/api/app",
      { action: "forwardFeed", id: privateId, toUserId: bobId },
      aliceCookie,
    )
    assert.equal(forwarded.status, 200)
    publicId = forwarded.body.id
    const publicFeed = await request<FeedDetail>(
      "/api/app",
      { action: "getFeed", id: publicId },
      bobCookie,
    )
    assert.equal(publicFeed.status, 200)
    assert.equal(publicFeed.body.isPublic, true)
    const comment = await request(
      "/api/app",
      { action: "comment", id: publicId, content: `Public comment ${suffix}` },
      bobCookie,
    )
    assert.equal(comment.status, 200)
    const updated = await request<FeedDetail>(
      "/api/app",
      { action: "getFeed", id: publicId },
      aliceCookie,
    )
    assert.ok(
      updated.body.comments.some(
        (reply) => reply.content === `Public comment ${suffix}`,
      ),
    )
  })

  it("stores preferences and conversation ownership in PostgreSQL", async () => {
    const preferences = `Solar physics and developer tools ${suffix}`
    const changed = await request<ProfileView>(
      "/api/app",
      { action: "updatePreferences", preferences },
      aliceCookie,
    )
    assert.equal(changed.status, 200)
    assert.equal(changed.body.preferences, preferences)
    const alice = await request<AppData>(
      "/api/app",
      { action: "bootstrap" },
      aliceCookie,
    )
    const bob = await request<AppData>(
      "/api/app",
      { action: "bootstrap" },
      bobCookie,
    )
    assert.equal(alice.body.profile.preferences, preferences)
    assert.notEqual(bob.body.profile.preferences, preferences)
    const conversation = await request<{ id: string }>(
      "/api/app",
      { action: "createThread" },
      aliceCookie,
    )
    assert.equal(conversation.status, 200)
    threadId = conversation.body.id
    const forbiddenRead = await request(
      "/api/app",
      { action: "getThread", id: threadId },
      bobCookie,
    )
    const forbiddenDelete = await request(
      "/api/app",
      { action: "deleteThread", id: threadId },
      bobCookie,
    )
    assert.equal(forbiddenRead.status, 404)
    assert.equal(forbiddenDelete.status, 404)
    const stored = await request<{ id: string; messages: unknown[] }>(
      "/api/app",
      { action: "getThread", id: threadId },
      aliceCookie,
    )
    assert.equal(stored.status, 200)
    assert.equal(stored.body.id, threadId)
    assert.deepEqual(stored.body.messages, [])
  })

  it("blocks local, metadata, and IPv6 destinations before article or RSS access", async () => {
    for (const url of [
      "http://localhost/article",
      "http://127.0.0.1/article",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/article",
      "http://[::ffff:127.0.0.1]/article",
    ]) {
      for (const action of ["submitFeed", "subscribe"]) {
        const result = await request("/api/app", { action, url }, aliceCookie)
        assert.equal(result.status, 400, `${action}: ${url}`)
      }
    }
  })

  it("rejects unknown AI models and reports unavailable provider keys", async () => {
    const unknown = await request(
      "/api/app",
      { action: "summarize", id: publicId, modelId: "unknown-model" },
      aliceCookie,
    )
    assert.equal(unknown.status, 400)
    const data = await request<AppData>(
      "/api/app",
      { action: "bootstrap" },
      aliceCookie,
    )
    const modelId = data.body.models[0]?.id
    assert.ok(modelId)
    const missing = await request(
      "/api/app",
      { action: "summarize", id: publicId, modelId },
      aliceCookie,
    )
    assert.equal(missing.status, 503)
    assert.match(String(missing.body.error), /API key is not set/)
  })

  it("serializes publication and redirects submissions to the existing public URL", async () => {
    assert.ok(client)
    const db = drizzle(client)
    const url = `https://example.com/stellar-integration-${suffix}`
    const first = randomUUID()
    const second = randomUUID()
    await db.insert(feeds).values([
      {
        id: first,
        authorId: aliceId,
        title: "First private link",
        url,
        content: "First article.",
        kind: "link",
        origin: "user",
      },
      {
        id: second,
        authorId: bobId,
        title: "Second private link",
        url,
        content: "Second article.",
        kind: "link",
        origin: "user",
      },
    ])
    const [one, two] = await Promise.all([
      request<{ id: string }>(
        "/api/app",
        { action: "forwardFeed", id: first, toUserId: bobId },
        aliceCookie,
      ),
      request<{ id: string }>(
        "/api/app",
        { action: "forwardFeed", id: second, toUserId: aliceId },
        bobCookie,
      ),
    ])
    assert.equal(one.status, 200, JSON.stringify(one.body))
    assert.equal(two.status, 200, JSON.stringify(two.body))
    assert.equal(one.body.id, two.body.id)
    const publicRows = await db
      .select({ id: feeds.id })
      .from(feeds)
      .where(and(eq(feeds.url, url), eq(feeds.isPublic, true)))
    assert.equal(publicRows.length, 1)
    const duplicate = await request<{ id: string; duplicate: boolean }>(
      "/api/app",
      {
        action: "submitFeed",
        url: `${url}?utm_source=integration#read`,
      },
      adminCookie,
    )
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.body.duplicate, true)
    assert.equal(duplicate.body.id, one.body.id)
    const totalRows = await db
      .select({ id: feeds.id })
      .from(feeds)
      .where(eq(feeds.url, url))
    assert.equal(totalRows.length, 2)
  })
})
