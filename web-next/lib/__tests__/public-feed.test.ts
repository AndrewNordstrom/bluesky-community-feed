import { afterEach, describe, expect, it, vi } from "vitest"
import {
  APPVIEW_BATCH_SIZE,
  PUBLIC_FEED_APPVIEW_TIMEOUT_MS,
  PUBLIC_FEED_MAX_REQUESTS_PER_REFRESH,
  PUBLIC_FEED_SNAPSHOT_TIMEOUT_MS,
  loadPublicFeed,
  publicFeedSnapshotSchema,
  retainSelectedUri,
  splitPostUris,
  strongestContribution,
} from "../public-feed"
import type { PublicFeedRankedItem, PublicFeedSnapshot } from "../public-feed"
import {
  BlueskyPublicDataError,
  bskyPostUrlFromAtUri,
  buildPostHydrationUrl,
  publicHiddenReason,
} from "../bluesky-public"

afterEach(() => {
  vi.useRealTimers()
})

function rankedItem(position: number, uri: string): PublicFeedRankedItem {
  return {
    position,
    epoch_id: 7,
    ranked_position: position,
    placement: "ranked",
    post_uri: uri,
    base_score: 0.4,
    publication_adjustment: 1,
    final_score: 0.4,
    components: {
      recency: { raw_score: 0.2, weight: 0.1, weighted: 0.02 },
      engagement: { raw_score: 0.4, weight: 0.4, weighted: 0.16 },
      bridging: { raw_score: 0.5, weight: 0.2, weighted: 0.1 },
      source_diversity: { raw_score: 0.55, weight: 0.2, weighted: 0.11 },
      relevance: { raw_score: 0.1, weight: 0.1, weighted: 0.01 },
    },
    source_score_run_id: "run-1",
    scored_at: "2026-09-02T17:00:00.000Z",
    classification_method: "keyword",
    engagement_only_position: position,
  }
}

function snapshot(items: readonly PublicFeedRankedItem[]): PublicFeedSnapshot {
  return {
    schema_version: 1,
    feed_uri: "at://did:plc:test/app.bsky.feed.generator/community-gov",
    presentation_snapshot_id: "snapshot-1",
    publication_run_id: "run-1",
    epoch_id: 7,
    published_at: "2026-09-02T17:00:00.000Z",
    status: "current",
    total_published_items: items.length,
    expected_refresh_seconds: 300,
    active_weights: {
      recency: 0.1,
      engagement: 0.4,
      bridging: 0.2,
      source_diversity: 0.2,
      relevance: 0.1,
    },
    items: [...items],
  }
}

function appViewPost(uri: string): Record<string, unknown> {
  return {
    uri,
    author: { handle: "ada.example", displayName: "Ada" },
    record: { text: `Post ${uri}` },
    indexedAt: "2026-09-02T17:00:00.000Z",
  }
}

describe("public feed contract", () => {
  it("withholds Bluesky hidden, warning, and adult-only labels", () => {
    for (const label of [
      "!no-unauthenticated", "!hide", "!takedown", "!warn",
      "porn", "sexual", "nudity", "graphic-media", "gore", "self-harm", "sexual-figurative",
    ]) {
      expect(publicHiddenReason([label], true)).not.toBeNull()
    }
    expect(publicHiddenReason(["  !TAKEDOWN  "], true)).toBe("Post hidden by Bluesky public-view policy")
    expect(publicHiddenReason([" PORN "], true)).toBe("Post hidden by Bluesky adult-content policy")
    expect(publicHiddenReason(["unrecognized-label"], true)).toBeNull()
    expect(publicHiddenReason([], true)).toBeNull()
    expect(publicHiddenReason([], false)).not.toBeNull()
  })

  it("enforces the Bluesky AppView 25-URI hydration limit", () => {
    const accepted = Array.from({ length: 25 }, (_, index) => `at://did:plc:test/app.bsky.feed.post/${index}`)
    expect(new URL(buildPostHydrationUrl(accepted)).searchParams.getAll("uris")).toEqual(accepted)
    expect(() => buildPostHydrationUrl([...accepted, "at://did:plc:test/app.bsky.feed.post/25"]))
      .toThrow(BlueskyPublicDataError)
  })

  it("encodes Bluesky profile and record-key URL segments", () => {
    const url = bskyPostUrlFromAtUri("at://did:plc:test/app.bsky.feed.post/a#b")
    expect(url).toBe("https://bsky.app/profile/did:plc:test/post/a%23b")
  })

  it("rejects unknown snapshot fields and invalid ranked/pinned nullability", () => {
    expect(publicFeedSnapshotSchema.safeParse({ ...snapshot([]), unexpected: true }).success).toBe(false)
    expect(publicFeedSnapshotSchema.safeParse({
      ...snapshot([rankedItem(1, "at://did:plc:test/app.bsky.feed.post/a")]),
      items: [{ ...rankedItem(1, "at://did:plc:test/app.bsky.feed.post/a"), final_score: null }],
    }).success).toBe(false)
  })

  it("accepts scored and scoreless pinned announcements but not mixed evidence", () => {
    const ranked = rankedItem(3, "at://did:plc:test/app.bsky.feed.post/pinned")
    const scoredPinned = { ...ranked, placement: "pinned_announcement" as const }
    const scorelessPinned = {
      position: 1,
      epoch_id: null,
      ranked_position: null,
      placement: "pinned_announcement" as const,
      post_uri: "at://did:plc:test/app.bsky.feed.post/inserted",
      base_score: null,
      publication_adjustment: null,
      final_score: null,
      components: null,
      source_score_run_id: null,
      scored_at: null,
      classification_method: null,
      engagement_only_position: null,
    }
    expect(publicFeedSnapshotSchema.safeParse({ ...snapshot([]), items: [scoredPinned, scorelessPinned] }).success).toBe(true)
    expect(publicFeedSnapshotSchema.safeParse({
      ...snapshot([]),
      items: [{ ...scoredPinned, final_score: null }],
    }).success).toBe(false)
  })

  it("caps hydration at two ordered batches of at most 25", () => {
    const uris = Array.from({ length: 50 }, (_, index) => `uri-${index + 1}`)
    const batches = splitPostUris(uris)
    expect(batches).toHaveLength(2)
    expect(batches.every((batch) => batch.length <= APPVIEW_BATCH_SIZE)).toBe(true)
    expect(batches.flat()).toEqual(uris)
    expect(() => splitPostUris([...uris, "uri-51"])).toThrow(/public limit is 50/)
  })

  it("uses one snapshot request plus at most two parallel hydration requests", async () => {
    const items = Array.from({ length: 50 }, (_, index) => (
      rankedItem(index + 1, `at://did:plc:test/app.bsky.feed.post/${index + 1}`)
    ))
    const requestedHydrationUrls: string[] = []
    let activeHydrations = 0
    let peakHydrations = 0
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("feed-snapshot")) {
        return new Response(JSON.stringify(snapshot(items)), {
          status: 200,
          headers: { "Content-Type": "application/json", ETag: '"snapshot-1"' },
        })
      }

      requestedHydrationUrls.push(url)
      activeHydrations += 1
      peakHydrations = Math.max(peakHydrations, activeHydrations)
      await Promise.resolve()
      activeHydrations -= 1
      const parsedUrl = new URL(url)
      return new Response(JSON.stringify({
        posts: parsedUrl.searchParams.getAll("uris").map(appViewPost),
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    })

    const result = await loadPublicFeed(new AbortController().signal, null, fetcher)
    expect(result.kind).toBe("loaded")
    if (result.kind !== "loaded") throw new Error("Expected a loaded result")
    expect(fetcher).toHaveBeenCalledTimes(PUBLIC_FEED_MAX_REQUESTS_PER_REFRESH)
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("/api/transparency/feed-snapshot?limit=50")
    expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe("omit")
    expect(fetcher.mock.calls[0]?.[1]?.cache).toBe("no-store")
    expect(requestedHydrationUrls).toHaveLength(2)
    expect(peakHydrations).toBe(2)
    expect(result.data.rows.map((row) => row.item.post_uri)).toEqual(items.map((item) => item.post_uri))
  })

  it("honors a 304 with one request and performs no hydration", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 304 }))
    const result = await loadPublicFeed(new AbortController().signal, '"snapshot-1"', fetcher)
    expect(result).toEqual({ kind: "not_modified", requestCount: 1 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const requestInit = fetcher.mock.calls[0]?.[1]
    expect(new Headers(requestInit?.headers).get("If-None-Match")).toBe('"snapshot-1"')
  })

  it("bounds the snapshot request and reports a timeout distinctly", async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
    }))

    const result = loadPublicFeed(new AbortController().signal, null, fetcher)
    const rejection = expect(result).rejects.toMatchObject({
      name: "PublicFeedDataError",
      kind: "request",
      message: `Public feed snapshot timed out after ${PUBLIC_FEED_SNAPSHOT_TIMEOUT_MS}ms`,
    })
    await vi.advanceTimersByTimeAsync(PUBLIC_FEED_SNAPSHOT_TIMEOUT_MS)
    await rejection
  })

  it("preserves caller cancellation instead of misreporting it as a timeout", async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const callerError = new DOMException("User navigated away", "AbortError")
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
    }))

    const result = loadPublicFeed(caller.signal, null, fetcher)
    const rejection = expect(result).rejects.toBe(callerError)
    caller.abort(callerError)
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })

  it("bounds AppView hydration while preserving the ranked snapshot", async () => {
    vi.useFakeTimers()
    const item = rankedItem(1, "at://did:plc:test/app.bsky.feed.post/a")
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes("feed-snapshot")) {
        return new Response(JSON.stringify(snapshot([item])), { status: 200 })
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
      })
    })

    const resultPromise = loadPublicFeed(new AbortController().signal, null, fetcher)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(PUBLIC_FEED_APPVIEW_TIMEOUT_MS)
    const result = await resultPromise
    if (result.kind !== "loaded") throw new Error("Expected a loaded result")
    expect(result.data.hydrationErrors).toEqual([
      `Bluesky AppView hydration timed out after ${PUBLIC_FEED_APPVIEW_TIMEOUT_MS}ms`,
    ])
    expect(result.data.rows[0]?.post.visibility).toBe("unavailable")
  })

  it("cleans up the AppView timeout when hydration is cancelled by the caller", async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const callerError = new DOMException("Feed view unmounted", "AbortError")
    const item = rankedItem(1, "at://did:plc:test/app.bsky.feed.post/a")
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes("feed-snapshot")) {
        return new Response(JSON.stringify(snapshot([item])), { status: 200 })
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
      })
    })

    const result = loadPublicFeed(caller.signal, null, fetcher)
    const rejection = expect(result).rejects.toBe(callerError)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)
    caller.abort(callerError)
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })

  it("preserves snapshot rows when AppView omits a post", async () => {
    const first = rankedItem(1, "at://did:plc:test/app.bsky.feed.post/a")
    const second = rankedItem(2, "at://did:plc:test/app.bsky.feed.post/b")
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("feed-snapshot")) {
        return new Response(JSON.stringify(snapshot([first, second])), { status: 200 })
      }
      return new Response(JSON.stringify({ posts: [appViewPost(second.post_uri)] }), { status: 200 })
    })
    const result = await loadPublicFeed(new AbortController().signal, null, fetcher)
    if (result.kind !== "loaded") throw new Error("Expected a loaded result")
    expect(result.data.rows.map((row) => row.item.post_uri)).toEqual([first.post_uri, second.post_uri])
    expect(result.data.rows[0]?.post.visibility).toBe("unavailable")
    expect(result.data.rows[1]?.post.visibility).toBe("public")
  })

  it("selects the strongest weighted contribution and retains URI selection", () => {
    const item = rankedItem(1, "at://did:plc:test/app.bsky.feed.post/a")
    expect(strongestContribution(item).key).toBe("engagement")
    const rows = [{
      item,
      post: { visibility: "unavailable" as const, uri: item.post_uri, reason: "Unavailable" },
    }]
    expect(retainSelectedUri(item.post_uri, rows)).toBe(item.post_uri)
    expect(retainSelectedUri("missing", rows)).toBe(item.post_uri)
  })
})
