# Decoupled Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the sidepanel's fixed 20-item display pagination from the forum's request pagination, loading additional request pages only when the local cache cannot cover the selected display page.

**Architecture:** Each list keeps an append-only request cache with its items, next forum request page, observed first-batch size, and end-of-data state. `ForumList` receives only the display-page slice and always paginates with `DEFAULT_PAGE_SIZE`; sidepanel loaders fill the cache to the requested display boundary before rendering. The first non-empty request response establishes the batch-size estimate used to calculate how many subsequent request pages to try, while actual response lengths remain the source of truth.

**Tech Stack:** Vue 3 `<script setup lang="ts">`, TypeScript strict mode, Node native assertion tests.

**Spec:** Approved decoupled-pagination design in the conversation on 2026-08-31.

## Global Constraints

- Cross-module reusable runtime constants remain in `src/global.ts`.
- Cross-module reusable TypeScript types remain in `src/type.ts`.
- Daily code verification runs `pnpm exec vue-tsc -b`; do not run `pnpm run build` unless explicitly requested.
- Existing message routing remains `chrome.tabs.sendMessage` through the content script.
- Do not fetch all pages eagerly; request only enough data for the selected display page.

---

### Task 1: Add request-page estimation coverage

**Files:**
- Modify: `src/utils/pagination.ts`
- Test: `tests/pagination.test.mjs`

**Interfaces:**
- Produces `getRequestPageCount(itemsNeeded: number, batchSize: number): number`, returning `0` when no items are needed and at least `1` for positive demand with an invalid batch size.

- [x] **Step 1: Write the failing test**

Add assertions showing that a 20-item display target needs two 12-item request batches when 20 items are still needed, that exact divisions do not over-request, and that no demand returns zero:

```js
import { getPageCount, getRequestPageCount, normalizePage } from '../src/utils/pagination.ts'

assert.equal(getRequestPageCount(20, 12), 2)
assert.equal(getRequestPageCount(24, 12), 2)
assert.equal(getRequestPageCount(0, 12), 0)
assert.equal(getRequestPageCount(20, 0), 1)
```

- [x] **Step 2: Run the test to verify it fails**

Run `node --experimental-strip-types tests/pagination.test.mjs`. It must fail because `getRequestPageCount` is not exported yet.

- [x] **Step 3: Implement the minimal calculation**

Add this pure helper beside `getPageCount`:

```ts
export function getRequestPageCount(itemsNeeded: number, batchSize: number): number {
  if (itemsNeeded <= 0) return 0
  if (batchSize <= 0) return 1
  return Math.ceil(itemsNeeded / batchSize)
}
```

- [x] **Step 4: Run the focused test to verify it passes**

Run `node --experimental-strip-types tests/pagination.test.mjs`; all assertions must pass.

### Task 2: Replace direct page loading with per-list caches

**Files:**
- Modify: `src/sidepanel/App.vue`
- Test: `tests/sidepanel-pagination.test.mjs`

**Interfaces:**
- Consumes `getRequestPageCount` from `src/utils/pagination.ts` and the existing `FETCH_THREADS`, `FETCH_FAVORITES`, and `FETCH_FRIENDS` message handlers.
- Produces `RequestCache<T>`, `ensureCached`, and three computed display slices local to the sidepanel.

- [x] **Step 1: Write the failing architecture regression test**

Read `App.vue` as text and assert that the implementation declares `firstBatchSize`, `nextRequestPage`, calls `ensureCached`, and passes `DEFAULT_PAGE_SIZE` to `ForumList` instead of each forum-reported `pageSize`:

```js
assert.match(source, /firstBatchSize/)
assert.match(source, /nextRequestPage/)
assert.match(source, /ensureCached/)
assert.match(source, /:page-size="DEFAULT_PAGE_SIZE"/)
```

- [x] **Step 2: Run the test to verify it fails**

Run `node tests/sidepanel-pagination.test.mjs`; it must fail against the current direct request-page implementation.

- [x] **Step 3: Add the cache state and helper**

Define the local cache shape and initialize one cache per list:

```ts
interface RequestCache<T> {
  items: T[]
  nextRequestPage: number
  firstBatchSize: number | null
  reachedEnd: boolean
}

function createRequestCache<T>(): RequestCache<T> {
  return { items: [], nextRequestPage: 1, firstBatchSize: null, reachedEnd: false }
}
```

Implement `ensureCached` to calculate an initial request count with `getRequestPageCount(targetCount - cache.items.length, cache.firstBatchSize ?? DEFAULT_PAGE_SIZE)`, request pages sequentially, record the first non-empty response length, append results, increment `nextRequestPage` only after success, and stop on an empty response or when the target count is covered.

- [x] **Step 4: Make display pagination independent**

Keep `threadsPage`, `favoritesPage`, and `friendsPage` as UI page numbers. Add a helper that computes `Math.min(total ?? page * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE)` and computed slices using `(page - 1) * DEFAULT_PAGE_SIZE`. Update `pageCountFor` and the `ForumList` bindings to use `DEFAULT_PAGE_SIZE` for display pagination.

- [x] **Step 5: Update the three loaders**

For each loader, set the UI page, call `ensureCached` with that page's display target and the matching content message, then derive fallback totals from the cache length only when the count total is unknown. Do not replace the cache with one response page.

- [x] **Step 6: Reset caches on refresh**

Add `resetRequestCaches()` to recreate all three caches and reset UI pages to `1` before `loadCounts()` in `refresh()`, ensuring refreshed data does not mix with old pages.

- [x] **Step 7: Run type checking**

Run `pnpm exec vue-tsc -b`. Fix all strict-mode and template type errors before proceeding.

- [x] **Step 8: Run the focused architecture test**

Run `node tests/sidepanel-pagination.test.mjs`; it must pass.

### Task 3: Verify the complete pagination behavior

**Files:**
- Test: `tests/pagination.test.mjs`, `tests/sidepanel-pagination.test.mjs`, and all existing `tests/*.mjs`

- [x] **Step 1: Verify first-page batching**

Confirm the cache records the first non-empty response length and requests enough sequential pages to cover 20 displayed items when the first response has fewer than 20 items.

- [x] **Step 2: Verify boundary loading**

Confirm navigating to a cached UI page makes no new request, while navigating beyond the cached boundary requests and appends only the missing request pages.

- [x] **Step 3: Verify end handling**

Confirm an empty response marks the cache as ended and does not cause repeated requests or an infinite loop.

- [x] **Step 4: Run all regression tests**

Run each test with Node's native TypeScript stripping:

```bash
node --experimental-strip-types tests/global.test.mjs
node --experimental-strip-types tests/float-button-site.test.mjs
node --experimental-strip-types tests/forum-count.test.mjs
node --experimental-strip-types tests/pagination.test.mjs
node --experimental-strip-types tests/auth.test.mjs
node --experimental-strip-types tests/page-meta.test.mjs
node --experimental-strip-types tests/uid.test.mjs
node --experimental-strip-types tests/forum-list-layout.test.mjs
node --experimental-strip-types tests/sidepanel-options.test.mjs
node --experimental-strip-types tests/sidepanel-pagination.test.mjs
```

- [x] **Step 5: Run final type checking**

Run `pnpm exec vue-tsc -b` again after all edits. Do not run `pnpm run build` unless explicitly requested.
