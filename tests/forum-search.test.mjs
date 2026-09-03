import assert from 'node:assert/strict'
import { buildForumSearchUrl, parseForumSearchPage } from '../src/utils/forum-api.ts'

class FakeElement {
  constructor({ text = '', href = '', attrs = {}, children = {} } = {}) {
    this.textContent = text
    this.href = href
    this.attrs = attrs
    this.children = children
  }

  querySelector(selector) {
    return this.children[selector]?.[0] ?? null
  }

  querySelectorAll(selector) {
    return this.children[selector] ?? []
  }

  getAttribute(name) {
    return this.attrs[name] ?? null
  }
}

const titleLink = new FakeElement({
  text: 'FC2 示例帖子',
  href: '/thread-123-1-1.html',
  attrs: { href: '/thread-123-1-1.html' },
})
const authorLink = new FakeElement({ text: '测试用户' })
const row = new FakeElement({
  children: {
    'h3.xs3 a': [titleLink],
    '.xg1 a': [authorLink],
    '.num a em, .num em': [new FakeElement({ text: '12' })],
    '.views': [new FakeElement({ text: '345' })],
    '.post-time': [new FakeElement({ text: '2026-09-01' })],
  },
})
const count = new FakeElement({ text: '搜索结果 42 条' })
const nextPage = new FakeElement({
  href: '/search.php?mod=forum&searchid=77&kw=fc2&page=2',
  attrs: { href: '/search.php?mod=forum&searchid=77&kw=fc2&page=2' },
})
const doc = {
  querySelectorAll(selector) {
    if (selector === 'li.pbw, .pbw li, div.pbw, .search-result') return [row]
    if (selector === '.search-info, .bm_h h2, .bm_h, .tbmu, .pg') return [count]
    if (selector === 'a[href]') return [nextPage]
    return []
  },
}

const parsed = parseForumSearchPage(doc, 'https://www.wnflb2023.com/search.php?mod=forum&searchid=77&kw=fc2')
assert.deepEqual(parsed.items[0], {
  id: '123',
  title: 'FC2 示例帖子',
  url: 'https://www.wnflb2023.com/thread-123-1-1.html',
  author: '测试用户',
  replies: '12',
  views: '345',
  postTime: '2026-09-01',
})
assert.equal(parsed.total, 42)
assert.equal(parsed.pageSize, 1)
assert.equal(parsed.searchId, '77')

const structuredTitleLink = new FakeElement({
  text: '手机NFC门禁卡v17.0 NFC读卡克隆工具 支持门禁、电梯、公交等',
  href: 'forum.php?mod=viewthread&tid=282380&highlight=fc',
  attrs: { href: 'forum.php?mod=viewthread&tid=282380&highlight=fc' },
})
const structuredAuthorLink = new FakeElement({
  text: '迷茫',
  href: 'space-uid-4710.html',
  attrs: { href: 'space-uid-4710.html' },
})
const structuredCategoryLink = new FakeElement({
  text: '网盘分享区',
  href: 'forum-50-1.html',
  attrs: { href: 'forum-50-1.html' },
})
const structuredRow = new FakeElement({
  text: '手机NFC门禁卡v17.0 NFC读卡克隆工具 支持门禁、电梯、公交等 0 个回复 - 90 次查看 2026-7-30 12:28 迷茫 网盘分享区',
  children: {
    'h3.xs3 a': [structuredTitleLink],
    '.xg1': [new FakeElement({ text: '0 个回复 - 90 次查看' })],
    'a[href*="space-uid-"], a[href*="home.php?mod=space&uid="]': [structuredAuthorLink],
    'a[href*="forum-"]': [structuredCategoryLink],
  },
})
const structuredDoc = {
  querySelectorAll(selector) {
    if (selector === 'li.pbw, .pbw li, div.pbw, .search-result') return [structuredRow]
    return []
  },
}
const structuredPage = parseForumSearchPage(
  structuredDoc,
  'https://www.wnflb2023.com/search.php?mod=forum&searchid=77&kw=fc2',
)
assert.deepEqual(structuredPage.items[0], {
  id: '282380',
  title: '手机NFC门禁卡v17.0 NFC读卡克隆工具 支持门禁、电梯、公交等',
  url: 'https://www.wnflb2023.com/forum.php?mod=viewthread&tid=282380&highlight=fc',
  author: '迷茫',
  replies: '0',
  views: '90',
  postTime: '2026-7-30 12:28',
  category: '网盘分享区',
})

const searchUrl = new URL(buildForumSearchUrl('www.wnflb2023.com', 'fc 2', 2, '77'))
assert.equal(searchUrl.pathname, '/search.php')
assert.equal(searchUrl.searchParams.get('mod'), 'forum')
assert.equal(searchUrl.searchParams.get('kw'), 'fc 2')
assert.equal(searchUrl.searchParams.get('page'), '2')
assert.equal(searchUrl.searchParams.get('searchid'), '77')

const resultCountDoc = {
  querySelectorAll(selector) {
    if (selector === '.sttl h2') {
      return [new FakeElement({ text: '结果: 找到 “fc” 相关内容 185 个' })]
    }
    return []
  },
}
const resultCountPage = parseForumSearchPage(
  resultCountDoc,
  'https://www.wnflb2023.com/search.php?mod=forum&searchid=138&kw=fc2',
)
assert.equal(resultCountPage.total, 185)

const noResultWithNavigationDoc = {
  querySelectorAll(selector) {
    if (selector === '.search-info, .bm_h h2, .bm_h, .tbmu, .pg') {
      return [new FakeElement({ text: '结果: 找到 “fc” 相关内容 185 个' })]
    }
    if (selector === 'a[href*="forum.php?mod=viewthread"], a[href*="thread-"]') {
      return Array.from({ length: 20 }, (_, index) => new FakeElement({
        text: '图床',
        href: `/forum.php?mod=viewthread&tid=${index + 1}`,
        attrs: { href: `/forum.php?mod=viewthread&tid=${index + 1}` },
      }))
    }
    return []
  },
}
const noResultPage = parseForumSearchPage(
  noResultWithNavigationDoc,
  'https://www.wnflb2023.com/search.php?mod=forum&searchid=138&kw=fc2&page=11',
)
assert.deepEqual(noResultPage.items, [])
