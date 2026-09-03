import assert from 'node:assert/strict'
import { getLocalDateKey, isCheckinCompletedLabel, shouldSkipAutoCheckin } from '../src/utils/checkin.ts'

const localDate = {
  getFullYear: () => 2026,
  getMonth: () => 8,
  getDate: () => 1,
}

assert.equal(getLocalDateKey(localDate), '2026-09-01')
assert.equal(isCheckinCompletedLabel('签到领奖'), false)
assert.equal(isCheckinCompletedLabel('今日已签到'), true)
assert.equal(isCheckinCompletedLabel('签到成功'), true)
assert.equal(shouldSkipAutoCheckin(true, '签到领奖'), false)
assert.equal(shouldSkipAutoCheckin(true, '今日已签到'), true)
assert.equal(shouldSkipAutoCheckin(true, null), true)
assert.equal(shouldSkipAutoCheckin(false, '今日已签到'), true)
assert.equal(shouldSkipAutoCheckin(false, null), false)
