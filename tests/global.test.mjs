import assert from 'node:assert/strict'
import { DEFAULT_PAGE_SIZE, ENABLED_SITES, MESSAGE_TYPES } from '../src/global.ts'

assert.deepEqual(ENABLED_SITES, ['fuliba2025.net', 'www.wnflb2023.com'])
assert.equal(DEFAULT_PAGE_SIZE, 20)
assert.equal(MESSAGE_TYPES.FETCH_THREADS, 'FETCH_THREADS')
assert.equal(MESSAGE_TYPES.OPEN_SIDE_PANEL, 'OPEN_SIDE_PANEL')
