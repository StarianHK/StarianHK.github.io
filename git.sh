#!/bin/bash

# 获取当前时间
commit_time=$(date "+%Y-%m-%d %H:%M:%S")

# 执行 git 操作
git add .

git commit -m "$commit_time"

git push
