import assert from 'node:assert/strict'
import { parsePageSizeFromHref, parsePageSizeFromText } from '../src/utils/forum-api.ts'

assert.equal(parsePageSizeFromHref('/forum.php?page=2&perpage=30'), 30)
assert.equal(parsePageSizeFromHref('/home.php?page=1&tpp=15'), 15)
assert.equal(parsePageSizeFromHref('/home.php?page=1'), null)
assert.equal(parsePageSizeFromText('每页显示 25 条'), 25)
assert.equal(parsePageSizeFromText('pageSize=40'), 40)
assert.equal(parsePageSizeFromText('没有分页设置'), null)
