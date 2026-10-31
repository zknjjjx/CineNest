#!/bin/sh
# CineNest 家庭影院一键安装（x86_64 / ARM 通用）
# 用法：sh install.sh [端口，默认 8899]
set -e
PORT="${1:-8899}"
cd "$(dirname "$0")"
command -v docker >/dev/null 2>&1 || { echo "未找到 docker，请先安装 Docker"; exit 1; }
if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else echo "未找到 docker compose 插件"; exit 1; fi
echo "设备架构：$(uname -m)"
mkdir -p data && [ -f data/extra.txt ] || echo "# 每行一个 Apple CMS 接口地址（api.php/provide/vod），可选" > data/extra.txt
sed -i "s/\"[0-9]*:8080\"/\"${PORT}:8080\"/" docker-compose.yml
# 清理旧版双容器
docker rm -f cms-web cms-collector >/dev/null 2>&1 || true
$DC up -d --build
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo "安装完成：http://${IP:-本机IP}:${PORT}"
echo "首次启动会在后台检测影视源（约 5 分钟），期间页面可正常打开。"
