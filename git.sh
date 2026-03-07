#!/usr/bin/env bash

echo "=============================="
echo " Git Auto Commit Script Start "
echo "=============================="

set -e

echo "[1/6] 生成提交信息..."
commit_msg=$(date "+%Y-%m-%d %H:%M:%S")
echo "commit message: $commit_msg"

echo "[2/6] 检查 git 用户配置..."
name=$(git config --global --get user.name || true)
email=$(git config --global --get user.email || true)

if [ -z "$name" ] || [ -z "$email" ]; then
  echo "未检测到全局 user.name 或 user.email"
  echo "写入当前仓库配置..."
  git config user.name "${name:-StarianHK}"
  git config user.email "${email:-chunlamli1231@outlook.com}"
fi

echo "[3/6] 添加文件..."
git add .

echo "[4/6] 检查是否有改动..."
if git diff --cached --quiet; then
  echo "没有改动，不需要提交"
  read -p "按回车退出..."
  exit 0
fi

echo "[5/6] 提交代码..."
git commit -m "$commit_msg"

echo "[6/6] 推送到远程..."
git push

echo "=============================="
echo "      Push 完成"
echo "=============================="

read -p "按回车退出..."