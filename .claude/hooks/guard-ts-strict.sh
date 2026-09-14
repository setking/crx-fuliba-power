#!/usr/bin/env bash
# guard-ts-strict.sh — 禁止关闭 TS 严格模式开关
#
# 触发条件：Edit/Write 写入 tsconfig.json / tsconfig.*.json
# 检查规则：strict / strictNullChecks / noUnusedLocals 任意被改为 false → 拒绝

source "$(dirname "$0")/lib.sh"
init_payload

file_path=$(payload '.tool_input.file_path')
new_string=$(payload '.tool_input.new_string')

# 只在 tsconfig 上生效
case "$file_path" in
  *tsconfig*.json) ;;
  *) allow ;;
esac

# 精确匹配 key 后的 false，避免误伤 noImplicitAny 等无关字段
violations=$(echo "$new_string" | grep -nE '"(strict|strictNullChecks|noUnusedLocals)"[[:space:]]*:[[:space:]]*false' || true)
if [ -n "$violations" ]; then
  deny "禁止关闭 TS 严格开关（strict / strictNullChecks / noUnusedLocals）。原行：$violations"
fi

allow