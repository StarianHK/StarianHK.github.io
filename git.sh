#!/usr/bin/env bash
set -e

commit_msg=$(date "+%Y-%m-%d %H:%M:%S")

# 如果全局没配置，就用仓库级别配置一次（不会影响别的仓库）
name=$(git config --global --get user.name || true)
email=$(git config --global --get user.email || true)

if [ -z "$name" ] || [ -z "$email" ]; then
  echo "未检测到全局 user.name/user.email，写入当前仓库配置..."
  git config user.name "${name:-StarianHK}"
  git config user.email "${email:-chunlamli1231@outlook.com}"
fi

git add .

# 没有改动就退出
if git diff --cached --quiet; then
  echo "没有改动，不需要提交"
  exit 0
fi

git commit -m "$commit_msg"

git push
