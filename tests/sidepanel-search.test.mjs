import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../src/sidepanel/App.vue', import.meta.url), 'utf8')
const listSource = readFileSync(new URL('../src/sidepanel/components/ForumList.vue', import.meta.url), 'utf8')
const globalSource = readFileSync(new URL('../src/global.ts', import.meta.url), 'utf8')
const contentSource = readFileSync(new URL('../src/content/main.ts', import.meta.url), 'utf8')

assert.match(globalSource, /FETCH_SEARCH/)
assert.match(contentSource, /MESSAGE_TYPES\.FETCH_SEARCH/)
assert.match(appSource, /searchInput/)
assert.match(appSource, /searchCache/)
assert.match(appSource, /searchid|searchId/)
assert.match(appSource, /FETCH_SEARCH/)
assert.match(appSource, /:page-size="DEFAULT_PAGE_SIZE"/)
assert.match(appSource, /searchPageCount/)
assert.match(appSource, /:page-count="searchPageCount"/)
assert.match(listSource, /kind === 'search'/)
assert.match(listSource, /pageCount\?: number/)
