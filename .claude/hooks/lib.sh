#!/usr/bin/env bash
# .claude/hooks/lib.sh — hook 共享最小工具集
#
# 原则（最小权限）：
#   - 只读 stdin（Claude 注入的 JSON）/ 只读目标文件，不写任何文件
#   - 只依赖 jq + grep + sed
#   - 不引入 set -e（避免 hook 在边缘情况意外阻断正常操作）
#
# 用法：
#   source "$(dirname "$0")/lib.sh"
#   init_payload                # 先调一次，把 stdin 缓存到 PAYLOAD_FILE
#   file_path=$(payload '.tool_input.file_path')
#   new_string=$(payload '.tool_input.new_string')
#   deny "原因"                  # 阻断并退出码 2（PreToolUse 拒绝语义）
#   allow                        # 通过并退出码 0

# 一次性缓存 Claude 注入的 JSON payload 到临时文件
# 用 mktemp 而不是进程替换，保证后续多次 jq 调用都从同一份数据读
init_payload() {
  PAYLOAD_FILE=$(mktemp)
  # trap 在子进程退出时清理（hook 退出时自动回收）
  trap 'rm -f "$PAYLOAD_FILE"' EXIT
  cat > "$PAYLOAD_FILE"
}

# 从缓存的 payload 中按 jq 路径取字段
# 用法：payload '.tool_input.file_path'
payload() {
  local path="$1"
  jq -r "$path // empty" "$PAYLOAD_FILE"
}

# 阻断当前 PreToolUse 请求
# 用法：deny "端口不能落在 5041–5240"
deny() {
  local reason="$1"
  # PreToolUse 拒绝语义：stdout 输出 hookSpecificOutput JSON，退出码 2
  jq -n --arg "reason" "$reason" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $reason
    }
  }'
  exit 2
}

# 通过当前请求（默认值；显式调用可读性更好）
allow() {
  exit 0
}