# Forum Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add keyword forum search to the sidepanel with Discuz result parsing and the same independent request/display pagination used by the existing lists.

**Architecture:** The search option gets a keyword form and reuses `ForumList` for result rendering. Content script remains the only network boundary; the first search response returns parsed results, total, observed page size, and dynamic `searchid`, while the sidepanel keeps an append-only cache per keyword and requests more forum pages only when a fixed 20-item display page is not covered.

**Tech Stack:** Vue 3 `<script setup lang="ts">`, TypeScript strict mode, `fetch` + `DOMParser`, Node native assertion tests.

**Spec:** Approved search design in the conversation on 2026-09-01.

## Global Constraints

- Cross-module reusable runtime constants remain in `src/global.ts`.
- Cross-module reusable TypeScript types remain in `src/type.ts`.
- Search requests go through `chrome.tabs.sendMessage` to the content script.
- `searchid` is extracted from the response and never hardcoded to the example value `77`.
- UI pagination always uses `DEFAULT_PAGE_SIZE`; request pagination is independent and sequential.
- After every `.ts` or `.vue` edit run `pnpm exec vue-tsc -b`; do not run `pnpm build`.
- Manual edits use `apply_patch`.

---

### Task 1: Add search parsing contracts and tests

**Files:**
- Modify: `src/type.ts`
- Test: `tests/forum-search.test.mjs`

**Interfaces:**
- `SearchResult` contains `id`, `title`, `url`, `author`, `replies`, optional `views` and `postTime`.
- `ForumSearchPage` contains `items: SearchResult[]`, `total: number | null`, `pageSize: number | null`, and `searchId: string | null`.

- [x] **Step 1: Write failing parser tests**

Use a representative Discuz result fragment with `li.pbw`, `h3.xs3 a`, author/date metadata, and pagination links. Assert title, URL, author, replies, views, post time, total, page size, and `searchid` extraction from the real parser API.

- [x] **Step 2: Run the focused test and verify the expected missing-export failure**

Run `node --experimental-strip-types tests/forum-search.test.mjs`. It should fail because the search parser/types do not exist yet.

- [x] **Step 3: Add shared search types and parser exports**

Define the interfaces in `src/type.ts` and implement pure parser functions in `src/utils/forum-api.ts` that accept a `Document` plus response URL, parse multiple Discuz selectors, and return the complete `ForumSearchPage` shape.

- [x] **Step 4: Run the focused parser test**

Run `node --experimental-strip-types tests/forum-search.test.mjs`; all assertions must pass.

### Task 2: Add the content search endpoint

**Files:**
- Modify: `src/global.ts`
- Modify: `src/utils/forum-api.ts`
- Modify: `src/content/main.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Message type `FETCH_SEARCH` accepts `{ keyword: string, page?: number, searchId?: string | null }`.
- `fetchForumSearch(keyword: string, page = 1, searchId?: string | null): Promise<ForumSearchPage>` builds `search.php?mod=forum&searchsubmit=yes&orderby=lastpost&ascdesc=desc&kw=...`, appends `searchid` only when known, and returns parsed page data.

- [x] **Step 1: Add a failing message-contract assertion**

Extend the parser test or a small source contract test to require `FETCH_SEARCH` in `MESSAGE_TYPES` and the content message route.

- [x] **Step 2: Implement URL construction and response parsing**

Keep request URLs same-origin, URL-encode keywords, preserve dynamic `searchid`, and capture `response.url` so redirects that introduce a search ID are supported.

- [x] **Step 3: Register the asynchronous content handler**

Resolve the current UID/login context through the existing content boundary, call `fetchForumSearch`, and return `{ ok: true, data }` or the existing `{ ok: false, error }` shape.

- [x] **Step 4: Run `pnpm exec vue-tsc -b` and focused tests**

Confirm strict types and parser/message assertions pass.

### Task 3: Add search UI and independent pagination

**Files:**
- Modify: `src/type.ts`
- Modify: `src/sidepanel/components/ForumList.vue`
- Modify: `src/sidepanel/App.vue`
- Test: `tests/sidepanel-search.test.mjs`

**Interfaces:**
- `ForumList` supports `kind="search"` and renders `SearchResult[]` using the existing open event.
- Sidepanel keeps `searchCache`, `searchKeyword`, `searchInput`, `searchPage`, and `searchCount`; `ensureSearchCached` requests pages sequentially with the cached `searchId`.

- [x] **Step 1: Write failing UI contract tests**

Assert that the search view contains a keyword input, `FETCH_SEARCH`, a search cache with `nextRequestPage`/`firstBatchSize`, and `ForumList` receives `DEFAULT_PAGE_SIZE`.

- [x] **Step 2: Implement search state and request cache**

Reuse the existing request-cache shape and target-page calculation. Reset cache when the submitted keyword changes, request page 1 first, store `searchId`, record the first non-empty batch size, append results, stop on empty responses, and derive unknown totals from cached item count.

- [x] **Step 3: Extend `ForumList` rendering**

Add the `search` branch with left-aligned titles and right-aligned metadata for author, views, replies, and post time; keep existing list behavior unchanged.

- [x] **Step 4: Replace the search placeholder**

Render a form and result list in the search option; submit on button or Enter, reject blank keywords, show loading/error/empty states, and allow page changes without reissuing cached pages.

- [x] **Step 5: Run the UI contract test and `pnpm exec vue-tsc -b`**

Fix all template and strict-mode errors before proceeding.

### Task 4: Full regression verification

**Files:**
- Test: all existing `tests/*.test.mjs` plus new search tests

- [x] **Step 1: Run focused search tests**

Run `node --experimental-strip-types tests/forum-search.test.mjs` and `node --experimental-strip-types tests/sidepanel-search.test.mjs`.

- [x] **Step 2: Run every test file**

Run each file under `tests/` with Node native TypeScript stripping and require exit code 0.

- [x] **Step 3: Run final type checking**

Run `pnpm exec vue-tsc -b` again. Do not run `pnpm build`.
