#!/usr/bin/env bash
# 以「演练模式」脱离式启动本机后端（端口 3000）。
# 为什么用 start：WorkBuddy 的后台任务有约 35 分钟生命周期上限，
# 用 run_in_background 起 node 会被连带回收；start 让 node 成为独立的
# Windows 进程树，不受该上限影响，关掉对话窗口也不会立刻死。
# 用法：在 Git Bash 里  bash start-dev.sh
set -e
cd "$(dirname "$0")"
NODE="C:/Users/liwei/.workbuddy/binaries/node/versions/22.12.0/node.exe"
: > server.log
cmd //c "set DAKA_ALLOW_CLOCK_OVERRIDE=1 & set DAKA_TODAY=2026-10-01 & start /min \"\" cmd /c \"$NODE src/index.js >> server.log 2>&1\""
echo "已脱离式启动（演练模式 today=2026-10-01）。稍后用脚本里的健康检查确认。"
