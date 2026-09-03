import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/sidepanel/App.vue', import.meta.url), 'utf8')

assert.match(source, /firstBatchSize/)
assert.match(source, /nextRequestPage/)
assert.match(source, /ensureCached/)
assert.match(source, /items\.length\s*<\s*batchSize/)
assert.match(source, /cache\.reachedEnd\s*=\s*true/)
assert.match(source, /:page-size="DEFAULT_PAGE_SIZE"/)
