import assert from "node:assert/strict"
import dns from "node:dns/promises"
import test, { type TestContext } from "node:test"
import { ConfigProvider, Deferred, Effect, Fiber } from "effect"
import { Agent, MockAgent } from "undici"
import {
  canonicalUrl,
  extractArticle,
  fetchDocument,
  isPublicAddress,
  validatePublicUrl,
} from "./content"

const testUrl = "https://www.eflx.top/blog/ui-composition-first-principle"
const dnsEndpoint = "https://cloudflare-dns.com/dns-query"

function checkUrl(value = testUrl, endpoint = dnsEndpoint) {
  return validatePublicUrl(value).pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown({ DNS_OVER_HTTPS_URL: endpoint }),
    ),
  )
}

function fakeDns(context: TestContext) {
  return context.mock.method(dns, "lookup", async () => [
    { address: "198.18.0.109", family: 4 },
    { address: "198.19.255.254", family: 4 },
  ])
}

function dnsAnswer(type: "A" | "AAAA", addresses: string[] = []) {
  return Response.json({
    Status: 0,
    TC: false,
    Question: [{ name: "www.eflx.top", type: type === "A" ? 1 : 28 }],
    Answer: [
      { name: "www.eflx.top", type: 5, TTL: 300, data: "cname.example.com" },
      ...addresses.map((address) => ({
        name: "cname.example.com",
        type: type === "A" ? 1 : 28,
        TTL: 300,
        data: address,
      })),
    ],
  })
}

test("article URLs reject local, private, mapped, and reserved addresses", async () => {
  for (const address of [
    "0.0.0.0",
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "224.0.0.1",
    "192.0.2.1",
    "198.18.0.109",
    "198.19.255.254",
    "198.51.100.1",
    "203.0.113.1",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:192.168.1.1",
    "2001:db8::1",
  ]) {
    assert.equal(isPublicAddress(address), false, address)
    const host = address.includes(":") ? `[${address}]` : address
    const result = await Effect.runPromise(
      Effect.result(validatePublicUrl(`https://${host}/article`)),
    )
    assert.equal(result._tag, "Failure", address)
  }
})

test("article URLs reject alternate IP encodings and private host names", async () => {
  for (const host of [
    "2130706433",
    "0x7f000001",
    "0177.0.0.1",
    "localhost",
    "feed.local",
    "feed.internal",
  ]) {
    const result = await Effect.runPromise(
      Effect.result(validatePublicUrl(`http://${host}/`)),
    )
    assert.equal(result._tag, "Failure", host)
  }
})

test("article URLs accept public IPv4 and IPv6 addresses", async () => {
  for (const address of ["1.1.1.1", "8.8.8.8", "2001:4860:4860::8888"]) {
    assert.equal(isPublicAddress(address), true, address)
    const host = address.includes(":") ? `[${address}]` : address
    const result = await Effect.runPromise(
      validatePublicUrl(`https://${host}/`),
    )
    assert.equal(result.addresses[0]?.address, address)
  }
})

test("public DNS answers retain the native route without an HTTPS lookup", async (context) => {
  const addresses = [
    { address: "66.33.60.129", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 },
  ]
  context.mock.method(dns, "lookup", async () => addresses)
  const remote = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("A public native answer must not use the fallback.")
  })
  const result = await Effect.runPromise(checkUrl(testUrl, "invalid URL"))
  assert.deepEqual(result.addresses, addresses)
  assert.equal(remote.mock.callCount(), 0)
})

test("fake DNS uses public HTTPS answers when one address family has no records", async (context) => {
  fakeDns(context)
  const questions: string[] = []
  context.mock.method(
    globalThis,
    "fetch",
    async (...[input, options]: Parameters<typeof globalThis.fetch>) => {
      const url = new URL(String(input))
      assert.equal(`${url.origin}${url.pathname}`, dnsEndpoint)
      assert.equal(url.searchParams.get("name"), "www.eflx.top")
      assert.ok(options?.signal instanceof AbortSignal)
      assert.equal(
        new Headers(options.headers).get("accept"),
        "application/dns-json",
      )
      const type = url.searchParams.get("type")
      assert.ok(type === "A" || type === "AAAA")
      questions.push(type)
      return dnsAnswer(
        type,
        type === "A" ? ["66.33.60.129", "66.33.60.130"] : [],
      )
    },
  )
  const result = await Effect.runPromise(checkUrl())
  assert.equal(result.url.toString(), testUrl)
  assert.deepEqual(questions.sort(), ["A", "AAAA"])
  assert.deepEqual(result.addresses, [
    { address: "66.33.60.129", family: 4 },
    { address: "66.33.60.130", family: 4 },
  ])
})

test("fake DNS retains both public address families from the HTTPS resolver", async (context) => {
  fakeDns(context)
  context.mock.method(
    globalThis,
    "fetch",
    async (...[input]: Parameters<typeof globalThis.fetch>) => {
      const type = new URL(String(input)).searchParams.get("type")
      return type === "A"
        ? dnsAnswer("A", ["66.33.60.129"])
        : dnsAnswer("AAAA", ["2606:4700:4700::1111"])
    },
  )
  const result = await Effect.runPromise(checkUrl())
  assert.deepEqual(result.addresses, [
    { address: "66.33.60.129", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 },
  ])
})

test("private hosts, IP literals, and mixed DNS answers cannot use the fallback", async (context) => {
  let addresses = [{ address: "198.18.0.109", family: 4 }]
  context.mock.method(dns, "lookup", async () => addresses)
  const remote = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("An unsafe host must not use the fallback.")
  })
  for (const host of [
    "198.18.0.109",
    "198.19.255.254",
    "[::ffff:198.18.0.109]",
    "localhost",
    "feed.local",
    "feed.internal",
  ]) {
    await assert.rejects(Effect.runPromise(checkUrl(`https://${host}/`)))
  }
  for (const values of [
    ["127.0.0.1"],
    ["10.1.2.3"],
    ["198.18.0.109", "10.1.2.3"],
    ["198.18.0.109", "66.33.60.129"],
    ["198.18.0.109", "198.51.100.1"],
    ["66.33.60.129", "127.0.0.1"],
  ]) {
    addresses = values.map((address) => ({ address, family: 4 }))
    await assert.rejects(Effect.runPromise(checkUrl()))
  }
  assert.equal(remote.mock.callCount(), 0)
})

test("native lookup failures cannot bypass the DNS policy", async (context) => {
  context.mock.method(dns, "lookup", async () => {
    throw Object.assign(new Error("No DNS entry"), { code: "ENOTFOUND" })
  })
  const remote = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("A lookup failure must not use the fallback.")
  })
  await assert.rejects(Effect.runPromise(checkUrl()), /host could not be found/)
  assert.equal(remote.mock.callCount(), 0)
})

test("HTTPS resolution rejects failures, incomplete answers, and private addresses", async (context) => {
  fakeDns(context)
  const remote = context.mock.method(globalThis, "fetch", async () =>
    dnsAnswer("A", ["66.33.60.129"]),
  )
  const invalidResponses = [
    () => new Response("Unavailable", { status: 503 }),
    () => Response.json({ Status: 3, TC: false, Answer: [] }),
    () => Response.json({ Status: 0, TC: true, Answer: [] }),
    () => dnsAnswer("A"),
    () => dnsAnswer("A", ["66.33.60.129", "127.0.0.1"]),
    () => dnsAnswer("A", ["198.18.0.109"]),
    () => dnsAnswer("AAAA", ["::ffff:127.0.0.1"]),
    () => dnsAnswer("A", ["invalid address"]),
    () => new Response("invalid JSON", { status: 200 }),
  ]
  for (const response of invalidResponses) {
    remote.mock.mockImplementation(async () => response())
    await assert.rejects(Effect.runPromise(checkUrl()))
  }
  remote.mock.mockImplementation(async (input) => {
    const type = new URL(String(input)).searchParams.get("type")
    return type === "A"
      ? dnsAnswer("A", ["66.33.60.129"])
      : dnsAnswer("AAAA", ["::1"])
  })
  await assert.rejects(Effect.runPromise(checkUrl()))
  remote.mock.mockImplementation(async () => {
    throw new Error("The resolver connection failed.")
  })
  await assert.rejects(Effect.runPromise(checkUrl()))
})

test("HTTPS resolution can be disabled and requires a valid trusted endpoint", async (context) => {
  fakeDns(context)
  const remote = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("An invalid endpoint must not receive a query.")
  })
  for (const endpoint of [
    "off",
    "invalid URL",
    "http://cloudflare-dns.com/dns-query",
    "https://user:secret@cloudflare-dns.com/dns-query",
    "https://cloudflare-dns.com/dns-query?name=other.example",
    "https://cloudflare-dns.com/dns-query#fragment",
  ]) {
    await assert.rejects(Effect.runPromise(checkUrl(testUrl, endpoint)))
  }
  assert.equal(remote.mock.callCount(), 0)
})

test("interrupting HTTPS resolution cancels both address queries", {
  timeout: 3_000,
}, async (context) => {
  fakeDns(context)
  const started = Deferred.makeUnsafe<void>()
  let starts = 0
  let cancellations = 0
  context.mock.method(
    globalThis,
    "fetch",
    (...[_input, options]: Parameters<typeof globalThis.fetch>) => {
      const signal = options?.signal
      assert.ok(signal instanceof AbortSignal)
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            cancellations++
            reject(signal.reason)
          },
          { once: true },
        )
        if (++starts === 2) Effect.runSync(Deferred.succeed(started, undefined))
      })
    },
  )
  const fiber = Effect.runFork(checkUrl())
  context.after(() => Effect.runPromise(Fiber.interrupt(fiber)))
  await Effect.runPromise(Deferred.await(started))
  await Effect.runPromise(Fiber.interrupt(fiber))
  assert.equal(cancellations, 2)
})

test("an HTTPS resolver failure cancels the other address query", {
  timeout: 3_000,
}, async (context) => {
  fakeDns(context)
  let starts = 0
  let failQuery: (() => void) | undefined
  let cancelled = false
  context.mock.method(
    globalThis,
    "fetch",
    (...[input, options]: Parameters<typeof globalThis.fetch>) => {
      const type = new URL(String(input)).searchParams.get("type")
      const signal = options?.signal
      assert.ok(signal instanceof AbortSignal)
      return new Promise<Response>((resolve, reject) => {
        if (type === "A")
          failQuery = () =>
            resolve(new Response("Unavailable", { status: 503 }))
        signal.addEventListener(
          "abort",
          () => {
            if (type === "AAAA") cancelled = true
            reject(signal.reason)
          },
          { once: true },
        )
        if (++starts === 2) failQuery?.()
      })
    },
  )
  await assert.rejects(Effect.runPromise(checkUrl()))
  assert.equal(cancelled, true)
})

test("a public HTTPS DNS answer cannot permit a redirect to a private host", async (context) => {
  fakeDns(context)
  const resolver = context.mock.method(
    globalThis,
    "fetch",
    async (...[input]: Parameters<typeof globalThis.fetch>) => {
      const type = new URL(String(input)).searchParams.get("type")
      return type === "A" ? dnsAnswer("A", ["66.33.60.129"]) : dnsAnswer("AAAA")
    },
  )
  const mock = new MockAgent()
  mock.disableNetConnect()
  context.mock.method(
    Agent.prototype,
    "dispatch",
    (...[options, handler]: Parameters<Agent["dispatch"]>) =>
      mock.get(String(options.origin)).dispatch(options, handler),
  )
  context.after(() => mock.close())
  mock
    .get("https://www.eflx.top")
    .intercept({ path: "/blog/ui-composition-first-principle", method: "GET" })
    .reply(302, "", {
      headers: { location: "http://169.254.169.254/latest/meta-data/" },
    })
  await assert.rejects(Effect.runPromise(fetchDocument(testUrl)), /public host/)
  assert.equal(resolver.mock.callCount(), 2)
})

test("URL normalization retains article parameters and removes tracking", () => {
  assert.equal(
    canonicalUrl(
      "https://EXAMPLE.com:443/article?z=2&utm_source=rss&a=1&fbclid=x#section",
    ),
    "https://example.com/article?a=1&z=2",
  )
  for (const url of [
    "file:///etc/passwd",
    "ftp://example.com/file",
    "https://user:secret@example.com/",
    "http://example.com:5432/",
  ]) {
    assert.throws(() => canonicalUrl(url))
  }
})

test("the article adapter reads HTML and rejects redirects to private hosts", async (context) => {
  const mock = new MockAgent()
  mock.disableNetConnect()
  context.mock.method(
    Agent.prototype,
    "dispatch",
    (...[options, handler]: Parameters<Agent["dispatch"]>) =>
      mock.get(String(options.origin)).dispatch(options, handler),
  )
  context.after(() => mock.close())
  const remote = mock.get("https://1.1.1.1")
  const text =
    "A feed reader collects articles from public sources and helps readers select useful information. ".repeat(
      20,
    )
  remote
    .intercept({ path: "/article", method: "GET" })
    .reply(
      200,
      `<html><head><title>Reader test</title></head><body><article><h1>Reader test</h1><p>${text}</p></article><script>secret code</script></body></html>`,
      { headers: { "content-type": "text/html" } },
    )
  const article = await Effect.runPromise(
    extractArticle("https://1.1.1.1/article"),
  )
  assert.equal(article.title, "Reader test")
  assert.ok(article.content.includes("A feed reader collects articles"))
  assert.ok(!article.content.includes("secret code"))
  remote.intercept({ path: "/redirect", method: "GET" }).reply(302, "", {
    headers: { location: "http://169.254.169.254/latest/meta-data/" },
  })
  await assert.rejects(
    Effect.runPromise(fetchDocument("https://1.1.1.1/redirect")),
    /public host/,
  )
})

test("the document adapter stops large responses and rejects binary content", async (context) => {
  const mock = new MockAgent()
  mock.disableNetConnect()
  context.mock.method(
    Agent.prototype,
    "dispatch",
    (...[options, handler]: Parameters<Agent["dispatch"]>) =>
      mock.get(String(options.origin)).dispatch(options, handler),
  )
  context.after(() => mock.close())
  const remote = mock.get("https://1.1.1.1")
  remote
    .intercept({ path: "/large", method: "GET" })
    .reply(200, "x".repeat(2_000_001), {
      headers: { "content-type": "text/plain" },
    })
  remote
    .intercept({ path: "/binary", method: "GET" })
    .reply(200, "binary", { headers: { "content-type": "image/png" } })
  await assert.rejects(
    Effect.runPromise(fetchDocument("https://1.1.1.1/large")),
    /could not be read/,
  )
  await assert.rejects(
    Effect.runPromise(fetchDocument("https://1.1.1.1/binary")),
    /could not be read/,
  )
})
