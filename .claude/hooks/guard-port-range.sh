#!/usr/bin/env bash
# guard-port-range.sh — 禁止把 vite 端口改到 WSL/Hyper-V 保留段 5041–5240
#
# 触发条件：Edit/Write 写入 vite.config.ts
# 拒绝语义：PreToolUse hookSpecificOutput.permissionDecision = "deny"

source "$(dirname "$0")/lib.sh"
init_payload

file_path=$(payload '.tool_input.file_path')
new_string=$(payload '.tool_input.new_string')

# 只在 vite.config.ts 上生效（其他文件不拦）
case "$file_path" in
  *vite.config.ts) ;;
  *) allow ;;
esac

# 检测 5041–5240 范围内的端口字面量
# 模式说明：port 字段后跟 4 位数字，故意略宽匹配 server.port / dev.port / 顶层 port 等
if echo "$new_string" | grep -qE 'port[":[:space:]]*[0-9]{4}'; then
  port=$(echo "$new_string" | grep -oE 'port[":[:space:]]*[0-9]{4}' | head -1 | grep -oE '[0-9]{4}')
  if [ -n "$port" ] && [ "$port" -ge 5041 ] && [ "$port" -le 5240 ]; then
    deny "端口 $port 落在 WSL/Hyper-V 保留段 5041–5240，请改回 5300 或其它安全段"
  fi
fi

allow