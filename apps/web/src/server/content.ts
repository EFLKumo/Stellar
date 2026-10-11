import dns from "node:dns/promises"
import { isIP } from "node:net"
import { Readability } from "@mozilla/readability"
import { RecordType } from "@multiformats/dns"
import { dnsJsonOverHttps } from "@multiformats/dns/resolvers"
import { Config, Effect } from "effect"
import ipaddr from "ipaddr.js"
import { parseHTML } from "linkedom"
import { Agent, fetch } from "undici"
import { AppError } from "./errors"

const MAX_BYTES = 2_000_000
const MAX_TEXT = 60_000
const NETWORK_TIMEOUT = 20_000
const FAKE_IP_RANGE = ipaddr.IPv4.parseCIDR("198.18.0.0/15")
const redirects = new Set([301, 302, 303, 307, 308])

export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast"
  } catch {
    return false
  }
}

export function canonicalUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AppError({ message: "Enter a valid URL.", status: 400 })
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  ) {
    throw new AppError({
      message: "Use a public HTTP or HTTPS URL.",
      status: 400,
    })
  }
  url.hash = ""
  for (const key of [...url.searchParams.keys()]) {
    if (
      /^utm_/i.test(key) ||
      ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key)
    ) {
      url.searchParams.delete(key)
    }
  }
  url.searchParams.sort()
  return url.toString()
}

const resolveProxyHostname = Effect.fn("content.resolveProxyHostname")(
  function* (hostname: string) {
    const endpoint = yield* Config.String("DNS_OVER_HTTPS_URL").pipe(
      Config.withDefault("https://cloudflare-dns.com/dns-query"),
    )
    if (endpoint === "off") return []
    const url = yield* Effect.try({
      try: () => {
        const url = new URL(endpoint)
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error(
            "Use an HTTPS DNS endpoint without credentials or parameters.",
          )
        return url
      },
      catch: (cause) =>
        new AppError({
          message: "Set DNS_OVER_HTTPS_URL to a valid HTTPS DNS endpoint.",
          status: 500,
          cause,
        }),
    })
    const resolve = dnsJsonOverHttps(url.toString())
    const responses = yield* Effect.forEach(
      [RecordType.A, RecordType.AAAA],
      (type) =>
        Effect.tryPromise({
          try: (signal) => resolve(hostname, { types: type, signal }),
          catch: (cause) =>
            new AppError({
              message: "The public DNS lookup failed. Try again.",
              status: 502,
              cause,
            }),
        }).pipe(
          Effect.filterOrFail(
            (response) => response.Status === 0 && !response.TC,
            () =>
              new AppError({
                message: "The public DNS lookup failed. Try again.",
                status: 502,
              }),
          ),
        ),
      { concurrency: 2 },
    ).pipe(
      Effect.timeout("10 seconds"),
      Effect.mapError((cause) =>
        cause instanceof AppError
          ? cause
          : new AppError({
              message: "The public DNS lookup timed out. Try again.",
              status: 502,
              cause,
            }),
      ),
    )
    return responses.flatMap((response) =>
      response.Answer.flatMap((answer) => {
        // The resolver normalizes numeric DNS record types to their names.
        const type = String(answer.type)
        return ["A", "AAAA", "1", "28"].includes(type)
          ? [{ address: answer.data, family: isIP(answer.data) }]
          : []
      }),
    )
  },
)

export const validatePublicUrl = Effect.fn("content.validatePublicUrl")(
  function* (value: string) {
    const url = yield* Effect.try({
      try: () => new URL(canonicalUrl(value)),
      catch: (cause) =>
        cause instanceof AppError
          ? cause
          : new AppError({ message: "Enter a valid URL.", status: 400, cause }),
    })
    const hostname = url.hostname.replace(/^\[|\]$/g, "")
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      (!hostname.includes(".") && !isIP(hostname))
    ) {
      return yield* new AppError({
        message: "The URL must use a public host.",
        status: 400,
      })
    }
    let addresses = yield* Effect.tryPromise({
      try: () =>
        isIP(hostname)
          ? Promise.resolve([{ address: hostname, family: isIP(hostname) }])
          : dns.lookup(hostname, { all: true, verbatim: true }),
      catch: (cause) =>
        new AppError({
          message: "The URL host could not be found.",
          status: 400,
          cause,
        }),
    }).pipe(
      Effect.timeout("10 seconds"),
      Effect.mapError((cause) =>
        cause instanceof AppError
          ? cause
          : new AppError({
              message: "The URL host lookup timed out.",
              status: 502,
              cause,
            }),
      ),
    )
    if (
      !isIP(hostname) &&
      addresses.length > 0 &&
      addresses.every(
        ({ address }) =>
          isIP(address) === 4 &&
          ipaddr.IPv4.parse(address).match(FAKE_IP_RANGE),
      )
    ) {
      addresses = yield* resolveProxyHostname(hostname)
    }
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicAddress(address))
    ) {
      return yield* new AppError({
        message: "The URL must use a public host.",
        status: 400,
      })
    }
    return { url, addresses }
  },
)

export const fetchDocument = Effect.fn("content.fetchDocument")(function* (
  value: string,
  accept = "text/html,text/plain,application/xhtml+xml",
) {
  let current = value
  for (let count = 0; count <= 5; count++) {
    const { url, addresses } = yield* validatePublicUrl(current)
    const result = yield* Effect.acquireUseRelease(
      Effect.sync(
        () =>
          new Agent({
            connect: {
              timeout: 10_000,
              lookup: (_hostname, options, callback) => {
                // The connection uses the addresses that passed the check.
                const selected =
                  addresses.find(
                    ({ family }) =>
                      !options.family || family === options.family,
                  ) ?? addresses[0]
                if (!selected) {
                  callback(new Error("No public address is available."), "", 4)
                } else if (options.all) {
                  callback(null, addresses)
                } else {
                  callback(null, selected.address, selected.family)
                }
              },
            },
          }),
      ),
      (dispatcher) =>
        Effect.tryPromise({
          try: async (signal) => {
            const response = await fetch(url, {
              dispatcher,
              redirect: "manual",
              signal: AbortSignal.any([
                signal,
                AbortSignal.timeout(NETWORK_TIMEOUT),
              ]),
              headers: {
                Accept: accept,
                "User-Agent": "Stellar/1.0 (feed reader)",
              },
            })
            if (redirects.has(response.status)) {
              await response.body?.cancel()
              const location = response.headers.get("location")
              if (!location) throw new Error("The redirect has no URL.")
              return {
                kind: "redirect" as const,
                url: new URL(location, url).toString(),
              }
            }
            if (!response.ok) {
              await response.body?.cancel()
              throw new Error(
                `The remote server returned HTTP ${response.status}.`,
              )
            }
            if (Number(response.headers.get("content-length")) > MAX_BYTES) {
              await response.body?.cancel()
              throw new Error("The document exceeds the size limit.")
            }
            const contentType = response.headers.get("content-type") ?? ""
            if (!/text\/|xml|json/i.test(contentType)) {
              await response.body?.cancel()
              throw new Error("The URL must return a text document.")
            }
            const reader = response.body?.getReader()
            if (!reader) throw new Error("The document is empty.")
            const decoder = new TextDecoder()
            let bytes = 0
            let text = ""
            try {
              while (true) {
                const chunk = await reader.read()
                if (chunk.done) break
                bytes += chunk.value.byteLength
                if (bytes > MAX_BYTES)
                  throw new Error("The document exceeds the size limit.")
                text += decoder.decode(chunk.value, { stream: true })
              }
              text += decoder.decode()
            } finally {
              await reader.cancel()
            }
            return {
              kind: "document" as const,
              url: url.toString(),
              text,
              contentType,
            }
          },
          catch: (cause) =>
            new AppError({
              message: "The document could not be read.",
              status: 502,
              cause,
            }),
        }),
      (dispatcher) => Effect.promise(() => dispatcher.destroy()),
    )
    if (result.kind === "redirect") {
      current = result.url
    } else {
      return result
    }
  }
  return yield* new AppError({
    message: "The URL has too many redirects.",
    status: 400,
  })
})

export const extractArticle = Effect.fn("content.extractArticle")(function* (
  url: string,
) {
  const source = yield* fetchDocument(url)
  return yield* Effect.try({
    try: () => {
      if (/^text\/plain/i.test(source.contentType)) {
        return {
          url: source.url,
          title: new URL(source.url).hostname,
          content: source.text.slice(0, MAX_TEXT),
        }
      }
      const { document } = parseHTML(source.text)
      Object.defineProperty(document, "documentURI", { value: source.url })
      Object.defineProperty(document, "baseURI", { value: source.url })
      const article = new Readability(document as unknown as Document).parse()
      for (const element of document.querySelectorAll(
        "script,style,nav,footer,header",
      )) {
        element.remove()
      }
      const content = (article?.textContent || document.body?.textContent || "")
        .replace(/\n[\t ]+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, MAX_TEXT)
      if (!content) throw new Error("The document has no article text.")
      return {
        url: source.url,
        title: (
          article?.title ||
          document.title ||
          new URL(source.url).hostname
        ).slice(0, 300),
        content,
      }
    },
    catch: (cause) =>
      new AppError({
        message: "The article text could not be read.",
        status: 422,
        cause,
      }),
  })
})
