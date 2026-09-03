import assert from 'node:assert/strict'
import { getPageCount, getRequestPageCount, normalizePage } from '../src/utils/pagination.ts'

assert.equal(getPageCount(0, 20), 1)
assert.equal(getPageCount(41, 20), 3)
assert.equal(getPageCount(10, 0), 1)
assert.equal(normalizePage(0, 3), 1)
assert.equal(normalizePage(4, 3), 3)
assert.equal(getRequestPageCount(20, 12), 2)
assert.equal(getRequestPageCount(24, 12), 2)
assert.equal(getRequestPageCount(0, 12), 0)
assert.equal(getRequestPageCount(20, 0), 1)
