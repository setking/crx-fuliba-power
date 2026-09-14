#!/usr/bin/env bash
# guard-no-ignore.sh — 禁止新增裸 @ts-ignore / @ts-nocheck / @ts-expect-error
#
# 触发条件：Edit/Write 写入 .ts / .vue
# 例外：被叙述性提到的（行首 // 后还有别的内容才到 @ts-...）不算违规
#       例："// 旧代码曾用 // @ts-ignore" → 不拦
#       例："// @ts-ignore" / "// @ts-ignore  TODO" / "/* @ts-ignore */" → 拦

source "$(dirname "$0")/lib.sh"
init_payload

file_path=$(payload '.tool_input.file_path')
new_string=$(payload '.tool_input.new_string')

case "$file_path" in
  *.ts|*.vue) ;;
  *) allow ;;
esac

# 行首空白 + // + 空白 + @ts-...  → 真违规
# 行首空白 + /* + 空白 + @ts-...  → 真违规（块注释里的裸指令）
violations=$(echo "$new_string" | grep -nE '^[[:space:]]*(//[[:space:]]+|/\*[[:space:]]+)@ts-(ignore|nocheck|expect-error)' || true)
if [ -n "$violations" ]; then
  deny "禁止新增 @ts-ignore / @ts-nocheck / @ts-expect-error。直接修问题，不要绕过类型系统。原行：$violations"
fi

allow