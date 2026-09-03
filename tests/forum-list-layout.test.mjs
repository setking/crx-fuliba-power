import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/sidepanel/components/ForumList.vue', import.meta.url), 'utf8')

assert.match(source, /\.thread-title\s*\{[\s\S]*?text-align:\s*left/)
assert.match(source, /\.thread-meta\s+\.replies\s*\{[\s\S]*?text-align:\s*right/)
assert.match(source, /\.fav-item\s*\{[\s\S]*?display:\s*flex/)
assert.match(source, /\.fav-date\s*\{[\s\S]*?text-align:\s*right/)
assert.match(source, /jumpPage/)
assert.match(source, /type="number"/)
assert.match(source, /@submit\.prevent="jumpToPage"/)
assert.match(source, /class="jump-button"/)
