#!/usr/bin/env bash
# guard-noUnusedLocals.sh — 写入 .ts/.vue 后做轻量 unused-import 检查
#
# 注意：本脚本只做"明显"的违规拦截（新增的 import 在同文件中没出现），
# 深度检测交给 pnpm exec vue-tsc -b（hook 不重复劳动）。
#
# 触发条件：Edit/Write 写入 .ts / .vue
# 误伤豁免：默认导出、副作用 import（如 'side-effect.css'）、字符串/注释中的同名符号

source "$(dirname "$0")/lib.sh"
init_payload

file_path=$(payload '.tool_input.file_path')
new_string=$(payload '.tool_input.new_string')

case "$file_path" in
  *.ts|*.vue) ;;
  *) allow ;;
esac

# 仅检测新增的 ESM import 语句（import xxx from '...'），
# 跳过 import type（type-only 不参与运行时，TS 自己会报更准确的）
# 提取 import 名字：兼容 default import (import foo from ...) 和 named import (import { foo, bar } from ...)
# ERE 模式下 ? 才是元字符；\{ 在 ERE 下是字面 \{，不能这样写
default_imports=$(echo "$new_string" | grep -E "^import [A-Za-z_][A-Za-z0-9_]* " | sed -nE 's/^import[[:space:]]+([A-Za-z_][A-Za-z0-9_]*).*/\1/p' || true)
named_imports=$(echo "$new_string" | grep -E "^import \{[^}]+\}" | sed -nE 's/^import[[:space:]]+\{([^}]+)\}.*/\1/p' | tr ',' '\n' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^([A-Za-z_][A-Za-z0-9_]*).*/\1/' || true)
imports=$(printf '%s\n%s' "$default_imports" "$named_imports" | grep -v '^$' || true)

[ -z "$imports" ] && allow

# 对每个新增 import，检查它在 new_string 主体（去掉 import 行后）中是否出现 ≥ 1 次
# （只要主体中出现就算被用——避免双重计数）
unused=""
while IFS= read -r name; do
  [ -z "$name" ] && continue
  body=$(echo "$new_string" | grep -vE "^import .*\b${name}\b")
  count=$(echo "$body" | grep -oE "\b${name}\b" | wc -l | tr -d ' ')
  if [ "$count" -eq 0 ]; then
    unused="$unused $name"
  fi
done <<< "$imports"

if [ -n "$unused" ]; then
  deny "检测到可能未使用的符号（新增 import 后主体中未引用）：$unused。若确实需要，请用 'import type' 或直接删除。"
fi

allow