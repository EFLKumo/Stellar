import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { Layer, ManagedRuntime, Redacted } from "effect"
import postgres from "postgres"
import { Ai } from "./ai"
import { AppConfig } from "./config"
import { Database } from "./database"
import * as schema from "./schema"

export const databaseTests = { skip: !process.env.TEST_DATABASE_URL }

export async function testApp() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error("Set TEST_DATABASE_URL to run database tests.")
  const client = postgres(url, { max: 1, onnotice: () => {} })
  const db = drizzle(client, { schema })
  const config = Layer.succeed(AppConfig, {
    databaseUrl: Redacted.make(url),
    authSecret: Redacted.make("a".repeat(32)),
    baseURL: "http://localhost:3000",
    models: [
      {
        id: "test",
        name: "Test Gemini",
        provider: "google",
        model: "gemini-test",
      },
    ],
    googleApiKey: Redacted.make("test-key"),
    openaiApiKey: Redacted.make(""),
    anthropicApiKey: Redacted.make(""),
    rssPollSeconds: 60,
    rssConcurrency: 2,
  })
  const runtime = ManagedRuntime.make(
    Ai.layer.pipe(
      Layer.provideMerge(Database.layer.pipe(Layer.provideMerge(config))),
    ),
  )
  const ids = [randomUUID(), randomUUID()] as const
  await db.insert(schema.user).values(
    ids.map((id) => ({
      id,
      name: `Reader ${id}`,
      email: `${id}@example.test`,
    })),
  )
  const database = await runtime.runPromise(Database)
  const ai = await runtime.runPromise(Ai)
  return {
    db,
    database,
    ai,
    runtime,
    owner: ids[0],
    other: ids[1],
    async feed(
      authorId: string,
      values: Partial<typeof schema.feeds.$inferInsert> = {},
    ) {
      const id = randomUUID()
      await db.insert(schema.feeds).values({
        id,
        authorId,
        title: "Article",
        content: "Article content about space exploration.",
        kind: "markdown",
        ...values,
      })
      return id
    },
    async thread(userId = ids[0], messages: import("ai").UIMessage[] = []) {
      const id = randomUUID()
      await db.insert(schema.threads).values({ id, userId, messages })
      return id
    },
    async threadRow(id: string) {
      const [row] = await db
        .select()
        .from(schema.threads)
        .where(eq(schema.threads.id, id))
      assert.ok(row)
      return row
    },
    async close() {
      try {
        await runtime.dispose()
        await db.delete(schema.user).where(inArray(schema.user.id, ids))
      } finally {
        await client.end({ timeout: 2 })
      }
    },
  }
}

export function googleResponse(text: string, streaming = false) {
  const body = {
    candidates: [
      { content: { role: "model", parts: [{ text }] }, finishReason: "STOP" },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 10,
      totalTokenCount: 20,
    },
    modelVersion: "gemini-test",
  }
  return new Response(
    streaming ? `data: ${JSON.stringify(body)}\n\n` : JSON.stringify(body),
    {
      headers: {
        "content-type": streaming ? "text/event-stream" : "application/json",
      },
    },
  )
}

export function googleChunk(text: string) {
  return new TextEncoder().encode(
    `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] } }] })}\n\n`,
  )
}

export function googleToolResponse(
  name: string,
  args: Record<string, unknown>,
) {
  const body = {
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            {
              functionCall: { name, args },
              thoughtSignature: "test-thought-signature",
            },
          ],
        },
        finishReason: "STOP",
      },
    ],
  }
  return new Response(`data: ${JSON.stringify(body)}\n\n`, {
    headers: { "content-type": "text/event-stream" },
  })
}
