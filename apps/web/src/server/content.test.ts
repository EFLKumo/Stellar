import assert from "node:assert/strict"
import test from "node:test"
import { Effect } from "effect"
import { Agent, MockAgent } from "undici"
import {
  canonicalUrl,
  extractArticle,
  fetchDocument,
  isPublicAddress,
  validatePublicUrl,
} from "./content"

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
