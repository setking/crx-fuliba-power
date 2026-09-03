import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../src/sidepanel/App.vue', import.meta.url), 'utf8')
const styleSource = readFileSync(new URL('../src/sidepanel/style.css', import.meta.url), 'utf8')

assert.match(appSource, /activeOption/)
assert.match(appSource, /我的/)
assert.match(appSource, /搜索/)
assert.match(appSource, /图床/)
assert.match(appSource, /userIcon/)
assert.match(appSource, /searchIcon/)
assert.match(appSource, /imageHostIcon/)
assert.match(appSource, /class="option-icon"/)
assert.doesNotMatch(appSource, /class="option-placeholder"/)
assert.match(appSource, /class="option-rail"/)
assert.match(appSource, /class="placeholder-view"/)
assert.doesNotMatch(appSource, /功能占位/)
assert.match(appSource, /class="placeholder-label"/)
assert.match(styleSource, /min-width:\s*360px/)
