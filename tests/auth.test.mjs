import assert from 'node:assert/strict'
import { isLoggedIn } from '../src/utils/auth.ts'

function setDocument(matches, cookie = '') {
  globalThis.document = {
    cookie,
    querySelector(selector) {
      return matches.has(selector) ? { querySelector: () => null } : null
    },
  }
}

setDocument(new Set(['#umenu', '.user-info', '.avt img', 'a[href*="logging.php?action=login"]']))
assert.equal(isLoggedIn(), false)

setDocument(new Set(['a[href*="logging.php?action=logout"]']))
assert.equal(isLoggedIn(), true)

setDocument(new Set(['a[href^="home.php?mod=space&uid="]']))
assert.equal(isLoggedIn(), false)

setDocument(new Set(['#umenu a[href^="home.php?mod=space&uid="]']))
assert.equal(isLoggedIn(), true)

setDocument(new Set(['#fx_checkin_topb']))
assert.equal(isLoggedIn(), true)

setDocument(new Set(), 'auth=non-empty-token')
assert.equal(isLoggedIn(), true)

setDocument(new Set(), 'auth=')
assert.equal(isLoggedIn(), false)

setDocument(new Set(), 'saltkey=guest-token')
assert.equal(isLoggedIn(), false)
