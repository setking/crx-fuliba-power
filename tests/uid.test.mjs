import assert from 'node:assert/strict'
import { getCurrentUid } from '../src/utils/forum-api.ts'

globalThis.window = {}

const posterLink = { href: 'https://forum.invalid/home.php?mod=space&uid=42' }
const currentUserLink = { href: 'https://forum.invalid/home.php?mod=space&uid=7' }

globalThis.document = {
  querySelector(selector) {
    if (selector === 'a[href*="home.php?mod=space&uid="]') return posterLink
    if (selector === '#umenu a[href*="home.php?mod=space&uid="]') return currentUserLink
    return null
  },
  querySelectorAll() {
    return []
  },
}

assert.equal(getCurrentUid(), '7')

globalThis.document = {
  querySelector(selector) {
    if (selector === 'a[href*="home.php?mod=space&uid="]') return posterLink
    return null
  },
  querySelectorAll() {
    return []
  },
}

assert.equal(getCurrentUid(), null)
