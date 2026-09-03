import { expect, test } from "@playwright/test"
import type { Page, Route } from "@playwright/test"

const POST_A = "at://did:plc:alpha/app.bsky.feed.post/a"
const POST_B = "at://did:plc:beta/app.bsky.feed.post/b"
const SUPERSEDED_RESPONSE_DELAY_MS = 1_000

type AppViewMode = "complete" | "omit-first" | "fail-last-batch" | "fail-all"

interface FixtureControl {
  snapshotId: string
  orderedUris: readonly string[]
  appViewMode: AppViewMode
  snapshotDelayMs: number
}

interface ObservedRequest {
  readonly method: string
  readonly url: string
}

interface FixtureObservations {
  readonly protectedRequests: string[]
  readonly snapshotRequests: ObservedRequest[]
  readonly appViewRequests: ObservedRequest[]
}

function scoreComponents(baseScore: number): Record<string, { raw_score: number; weight: number; weighted: number }> {
  const recencyWeighted = baseScore - 0.6125
  return {
    recency: { raw_score: recencyWeighted / 0.2, weight: 0.2, weighted: recencyWeighted },
    engagement: { raw_score: 0.9, weight: 0.3, weighted: 0.27 },
    bridging: { raw_score: 0.7, weight: 0.2, weighted: 0.14 },
    source_diversity: { raw_score: 0.6, weight: 0.15, weighted: 0.09 },
    relevance: { raw_score: 0.75, weight: 0.15, weighted: 0.1125 },
  }
}

function snapshotPayload(control: FixtureControl): Record<string, unknown> {
  return {
    schema_version: 1,
    feed_uri: "at://did:plc:corgi/app.bsky.feed.generator/community-gov",
    presentation_snapshot_id: control.snapshotId,
    publication_run_id: `run-${control.snapshotId}`,
    epoch_id: 12,
    published_at: new Date().toISOString(),
    status: "current",
    total_published_items: control.orderedUris.length,
    expected_refresh_seconds: 300,
    active_weights: {
      recency: 0.2,
      engagement: 0.3,
      bridging: 0.2,
      source_diversity: 0.15,
      relevance: 0.15,
    },
    items: control.orderedUris.map((uri, index) => {
      const baseScore = 0.92 - index * 0.01
      return {
        position: index + 1,
        epoch_id: 12,
        ranked_position: index + 1,
        placement: "ranked",
        post_uri: uri,
        base_score: baseScore,
        publication_adjustment: 1,
        final_score: baseScore,
        components: scoreComponents(baseScore),
        source_score_run_id: `score-${control.snapshotId}`,
        scored_at: new Date().toISOString(),
        classification_method: "keyword",
        engagement_only_position: index === 0 ? 2 : index === 1 ? 1 : index + 1,
      }
    }),
  }
}

function appViewPost(uri: string): Record<string, unknown> {
  const suffix = uri.split("/").at(-1) ?? "unknown"
  return {
    uri,
    author: {
      handle: `${suffix}.example`,
      displayName: `Author ${suffix.toUpperCase()}`,
    },
    record: { text: `Post ${suffix}`, langs: ["en"] },
    indexedAt: "2026-09-02T17:00:00.000Z",
    likeCount: 12,
    repostCount: 4,
    replyCount: 2,
  }
}

function assertSnapshotRequest(request: ObservedRequest): void {
  const url = new URL(request.url)
  expect(request.method).toBe("GET")
  expect(url.pathname).toBe("/api/transparency/feed-snapshot")
  expect([...url.searchParams.entries()]).toEqual([["limit", "50"]])
}

function appViewUris(request: ObservedRequest): readonly string[] {
  const url = new URL(request.url)
  return url.searchParams.getAll("uris")
}

function assertAppViewRequest(request: ObservedRequest): void {
  const url = new URL(request.url)
  expect(request.method).toBe("GET")
  expect(url.origin).toBe("https://public.api.bsky.app")
  expect(url.pathname).toBe("/xrpc/app.bsky.feed.getPosts")
  expect([...url.searchParams.keys()].every((key) => key === "uris")).toBe(true)
  const uris = url.searchParams.getAll("uris")
  expect(uris.length).toBeGreaterThan(0)
  expect(uris.length).toBeLessThanOrEqual(25)
  expect(new Set(uris).size).toBe(uris.length)
}

async function fulfillSnapshot(
  route: Route,
  control: FixtureControl,
  observations: FixtureObservations,
): Promise<void> {
  observations.snapshotRequests.push({
    method: route.request().method(),
    url: route.request().url(),
  })
  const requestControl: FixtureControl = {
    snapshotId: control.snapshotId,
    orderedUris: [...control.orderedUris],
    appViewMode: control.appViewMode,
    snapshotDelayMs: control.snapshotDelayMs,
  }
  if (requestControl.snapshotDelayMs > 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, requestControl.snapshotDelayMs)
    })
  }
  const etag = `"${requestControl.snapshotId}"`
  if (route.request().headers()["if-none-match"] === etag) {
    await route.fulfill({ status: 304, headers: { ETag: etag } })
    return
  }
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { ETag: etag },
    body: JSON.stringify(snapshotPayload(requestControl)),
  })
}

async function fulfillAppView(
  route: Route,
  control: FixtureControl,
  observations: FixtureObservations,
): Promise<void> {
  const observedRequest = {
    method: route.request().method(),
    url: route.request().url(),
  }
  observations.appViewRequests.push(observedRequest)
  const uris = appViewUris(observedRequest)
  const finalUri = control.orderedUris.at(-1)
  const isLastBatch = finalUri !== undefined && uris.includes(finalUri)
  if (control.appViewMode === "fail-all" || (control.appViewMode === "fail-last-batch" && isLastBatch)) {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "fixture AppView failure" }),
    })
    return
  }

  const visibleUris = control.appViewMode === "omit-first" ? uris.slice(1) : uris
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ posts: visibleUris.map(appViewPost) }),
  })
}

async function installFeedFixtures(page: Page, control: FixtureControl): Promise<FixtureObservations> {
  const observations: FixtureObservations = {
    protectedRequests: [],
    snapshotRequests: [],
    appViewRequests: [],
  }
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (/^\/api\/(?:admin|auth|session)(?:\/|$)/.test(path) || path === "/api/governance/auth/session") {
      observations.protectedRequests.push(path)
    }
  })
  await page.route("**/api/transparency/feed-snapshot**", async (route) => {
    await fulfillSnapshot(route, control, observations)
  })
  await page.route("**/xrpc/app.bsky.feed.getPosts**", async (route) => {
    await fulfillAppView(route, control, observations)
  })
  return observations
}

async function openLoadedFeed(page: Page, control: FixtureControl): Promise<string[]> {
  const observations = await installFeedFixtures(page, control)
  await page.goto("/feed/", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("heading", { level: 1, name: /See the live feed/i })).toBeVisible()
  await expect(page.locator("[data-feed-row-uri]").first()).toBeVisible()
  expect(observations.snapshotRequests.length).toBeGreaterThan(0)
  observations.snapshotRequests.forEach(assertSnapshotRequest)
  expect(observations.appViewRequests.length).toBeGreaterThan(0)
  observations.appViewRequests.forEach(assertAppViewRequest)
  return observations.protectedRequests
}

async function tabToNthWhyButton(page: Page, occurrence: number): Promise<void> {
  let seen = 0
  for (let press = 0; press < 50; press += 1) {
    await page.keyboard.press("Tab")
    const activeText = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "")
    if (activeText.includes("Why this order")) {
      seen += 1
      if (seen === occurrence) return
    }
  }
  throw new Error(`Keyboard focus did not reach Why this order button ${occurrence}`)
}

test("is usable while signed out on desktop and mobile", async ({ page }, testInfo) => {
  const control: FixtureControl = { snapshotId: "initial", orderedUris: [POST_A, POST_B], appViewMode: "complete", snapshotDelayMs: 0 }
  const protectedRequests = await openLoadedFeed(page, control)
  await expect(page.getByText("Post a", { exact: true })).toBeVisible()
  await expect(page.getByText("Active weights", { exact: true })).toBeVisible()

  if (testInfo.project.name === "desktop-chrome") {
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible()
    await expect(page.getByRole("complementary", { name: "Selected post ranking explanation" })).toBeVisible()
  } else {
    await expect(page.getByRole("complementary", { name: "Selected post ranking explanation" })).toBeHidden()
    const explainButton = page.getByRole("button", { name: "Why this order" }).first()
    await expect(explainButton).toHaveAttribute("aria-expanded", "false")
    await explainButton.click()
    await expect(explainButton).toHaveAttribute("aria-expanded", "true")
    await expect(page.locator("#feed-explanation-mobile-1")).toBeVisible()
    await page.getByRole("button", { name: "Open menu" }).click()
    await expect(page.getByRole("button", { name: /Already approved.*Sign in/i })).toBeVisible()
  }
  expect(protectedRequests).toEqual([])
})

test("supports keyboard-only explanation inspection", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop inspector is the keyboard acceptance surface")
  const control: FixtureControl = { snapshotId: "keyboard", orderedUris: [POST_A, POST_B], appViewMode: "complete", snapshotDelayMs: 0 }
  await openLoadedFeed(page, control)
  await tabToNthWhyButton(page, 2)
  await page.keyboard.press("Enter")
  await expect(page.getByRole("button", { name: "Why this order" }).nth(1)).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("complementary", { name: "Selected post ranking explanation" })).toContainText("Why position 2")
  await expect(page.getByRole("complementary", { name: "Selected post ranking explanation" })).toContainText("Above: position 1")
})

test("notifies before accepting a reordered snapshot and retains URI selection", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One desktop flow covers the shared refresh state machine")
  const control: FixtureControl = { snapshotId: "before", orderedUris: [POST_A, POST_B], appViewMode: "complete", snapshotDelayMs: 0 }
  await openLoadedFeed(page, control)
  await page.getByRole("button", { name: "Why this order" }).nth(1).click()
  await expect(page.getByRole("button", { name: "Why this order" }).nth(1)).toHaveAttribute("aria-pressed", "true")

  control.snapshotId = "after"
  control.orderedUris = [POST_B, POST_A]
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(page.getByRole("button", { name: "Show latest" })).toBeVisible()
  await expect(page.locator("[data-feed-row-uri]").first()).toHaveAttribute("data-feed-row-uri", POST_A)

  await page.getByRole("button", { name: "Show latest" }).click()
  await expect(page.locator("[data-feed-row-uri]").first()).toHaveAttribute("data-feed-row-uri", POST_B)
  await expect(page.getByRole("button", { name: "Why this order" }).first()).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("complementary", { name: "Selected post ranking explanation" })).toContainText("Why position 1")
})

test("deduplicates background checks and ignores a superseded late response", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One desktop flow covers the shared request coordinator")
  let snapshotRequestCount = 0
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/transparency/feed-snapshot") {
      snapshotRequestCount += 1
    }
  })
  const control: FixtureControl = { snapshotId: "initial", orderedUris: [POST_A, POST_B], appViewMode: "complete", snapshotDelayMs: 0 }
  await openLoadedFeed(page, control)
  expect(snapshotRequestCount).toBe(1)

  control.snapshotId = "slow-background"
  control.snapshotDelayMs = SUPERSEDED_RESPONSE_DELAY_MS
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"))
    window.dispatchEvent(new Event("focus"))
    window.dispatchEvent(new Event("focus"))
  })
  await expect.poll(() => snapshotRequestCount).toBe(2)
  const refreshButton = page.getByRole("button", { name: "Check for updates" })
  await expect(refreshButton).toHaveAttribute("data-refreshing", "true")

  control.snapshotId = "manual-newer"
  control.orderedUris = [POST_B, POST_A]
  control.snapshotDelayMs = 0
  await refreshButton.click()
  await expect.poll(() => snapshotRequestCount).toBe(3)
  await expect(page.getByRole("button", { name: "Show latest" })).toBeVisible()
  await page.waitForTimeout(SUPERSEDED_RESPONSE_DELAY_MS + 250)
  await expect(page.getByRole("button", { name: "Show latest" })).toBeVisible()

  await page.getByRole("button", { name: "Show latest" }).click()
  await expect(page.locator("[data-feed-row-uri]").first()).toHaveAttribute("data-feed-row-uri", POST_B)
})

test("disables row layout animation for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  const control: FixtureControl = { snapshotId: "reduced", orderedUris: [POST_A, POST_B], appViewMode: "complete", snapshotDelayMs: 0 }
  await openLoadedFeed(page, control)
  await expect(page.locator("[data-feed-row-uri]")).toHaveCount(2)
  await expect(page.locator('[data-motion-duration="0"]')).toHaveCount(2)
})

test("has no horizontal overflow and survives a hard refresh", async ({ page }) => {
  const control: FixtureControl = { snapshotId: "responsive", orderedUris: [POST_A, POST_B], appViewMode: "complete", snapshotDelayMs: 0 }
  await openLoadedFeed(page, control)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.getByRole("heading", { level: 1, name: /See the live feed/i })).toBeVisible()
  await expect(page.locator("[data-feed-row-uri]")).toHaveCount(2)
})

test("preserves an unavailable row when AppView omits a post", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One desktop flow covers shared hydration behavior")
  const control: FixtureControl = { snapshotId: "partial", orderedUris: [POST_A, POST_B], appViewMode: "omit-first", snapshotDelayMs: 0 }
  await openLoadedFeed(page, control)
  await expect(page.getByText("Partial post details.")).toBeVisible()
  await expect(page.locator('[data-feed-row-uri="' + POST_A + '"]')).toContainText("Post unavailable")
  await expect(page.locator('[data-feed-row-uri="' + POST_B + '"]')).toContainText("Post b")
})

test("keeps ranking evidence visible when an AppView batch fails", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One desktop flow covers shared hydration behavior")
  const uris = Array.from({ length: 26 }, (_, index) => `at://did:plc:fixture/app.bsky.feed.post/${index + 1}`)
  const control: FixtureControl = { snapshotId: "failed-batch", orderedUris: uris, appViewMode: "fail-last-batch", snapshotDelayMs: 0 }
  await openLoadedFeed(page, control)
  await expect(page.getByText(/1 post is unavailable from Bluesky/i)).toBeVisible()
  await expect(page.locator('[data-feed-row-uri="' + uris[25] + '"]')).toContainText("Post unavailable")
  await expect(page.locator('[data-feed-row-uri="' + uris[25] + '"]')).toContainText("published position and score remain visible")
})

test("shows the ordered evidence when AppView hydration is entirely unavailable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One desktop flow covers shared hydration behavior")
  const control: FixtureControl = { snapshotId: "failed-all", orderedUris: [POST_A, POST_B], appViewMode: "fail-all", snapshotDelayMs: 0 }
  await openLoadedFeed(page, control)
  await expect(page.getByText(/2 posts are unavailable from Bluesky/i)).toBeVisible()
  await expect(page.locator("[data-feed-row-uri]")).toHaveCount(2)
  await expect(page.getByRole("complementary", { name: "Selected post ranking explanation" })).toContainText("Score 0.920")
})
