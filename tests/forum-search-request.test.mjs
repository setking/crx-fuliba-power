import assert from 'node:assert/strict'
import { fetchForumSearch } from '../src/utils/forum-api.ts'

const requests = []
const emptyDocument = {
  querySelectorAll() {
    return []
  },
  querySelector() {
    return null
  },
}

globalThis.location = { host: 'www.wnflb2023.com' }
globalThis.document = {
  querySelector(selector) {
    if (selector === 'input[name="formhash"]') return { value: 'abc123' }
    return null
  },
}
globalThis.DOMParser = class {
  parseFromString() {
    return emptyDocument
  }
}
globalThis.fetch = async (url, init) => {
  requests.push({ url, init })
  return {
    ok: true,
    url: 'https://www.wnflb2023.com/search.php?mod=forum&searchid=138&orderby=lastpost&ascdesc=desc&searchsubmit=yes&kw=idm',
    text: async () => '',
  }
}

const firstPage = await fetchForumSearch('idm')
assert.equal(firstPage.searchId, '138')
assert.equal(requests[0].url, 'https://www.wnflb2023.com/search.php?mod=forum')
assert.equal(requests[0].init.method, 'POST')
assert.equal(requests[0].init.body, 'formhash=abc123&srchtxt=idm&searchsubmit=yes')

await fetchForumSearch('idm', 2, '138')
assert.equal(requests[1].init.method, undefined)
assert.equal(requests[1].init.credentials, 'include')
const secondUrl = new URL(requests[1].url)
assert.equal(secondUrl.searchParams.get('searchid'), '138')
assert.equal(secondUrl.searchParams.get('page'), '2')
