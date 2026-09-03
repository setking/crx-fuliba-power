import assert from 'node:assert/strict'
import { parseForumCount } from '../src/utils/forum-api.ts'

assert.equal(parseForumCount('当前共有 7 个好友'), 7)
assert.equal(parseForumCount('共有 42 个主题'), 42)
assert.equal(parseForumCount('我的收藏 (13)'), 13)
assert.equal(parseForumCount('暂无好友'), null)
