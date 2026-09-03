import assert from 'node:assert/strict'
import { isFloatButtonSite } from '../src/utils/sites.ts'

assert.equal(isFloatButtonSite('www.wnflb2023.com'), true)
assert.equal(isFloatButtonSite('fuliba2025.net'), false)
