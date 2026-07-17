#!/usr/bin/env bash
# 一键更新官网 Live Demo(dear-future-app.vercel.app/demo)
#
# 做四件事:
#   1. 用最新 app 代码导出 Expo web 版(apps/mobile/dist)
#   2. 修正资源路径:assets/node_modules → assets/_libs(Vercel 不部署叫 node_modules 的目录)
#   3. 替换 web/reveal/app(iframe 里跑的就是它)
#   4. 部署到 Vercel 生产环境并验证
#
# 用法:./scripts/update-demo.sh          # 导出 + 替换(部署前可先 git diff 检查)
#       ./scripts/update-demo.sh deploy   # 导出 + 替换 + 直接部署生产
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "── 1/4 Expo web export ──"
cd "$ROOT/apps/mobile"
rm -rf dist
npx expo export -p web

echo "── 2/4 asset path fixup ──"
cd dist
mv assets/node_modules assets/_libs
LC_ALL=C sed -i '' 's|assets/node_modules|assets/_libs|g' _expo/static/js/web/entry-*.js index.html
if grep -q 'assets/node_modules' _expo/static/js/web/entry-*.js; then
  echo "ERROR: node_modules references remain in bundle" >&2
  exit 1
fi
# 去掉浏览器给输入框画的蓝色焦点圈(focus ring)—— 信纸有自己的光标,蓝框破坏纸感。
# 注:app.json 是 web.output "single",expo-router 的 +html.tsx 不生效,所以在这里注入。
LC_ALL=C sed -i '' 's|</head>|<style>textarea:focus,input:focus{outline:none}</style></head>|' index.html
if ! grep -q 'outline:none' index.html; then
  echo "ERROR: focus-ring CSS injection failed" >&2
  exit 1
fi

echo "── 3/4 replace web/reveal/app ──"
cd "$ROOT"
rm -rf web/reveal/app
cp -R apps/mobile/dist web/reveal/app

if [ "${1:-}" = "deploy" ]; then
  echo "── 4/4 deploy to production ──"
  npx vercel deploy --prod --archive=tgz --yes
  echo "verify:"
  curl -s -o /dev/null -w "  /demo  %{http_code}\n" https://dear-future-app.vercel.app/demo
  curl -s -o /dev/null -w "  /app   %{http_code}\n" https://dear-future-app.vercel.app/app
else
  echo "── 4/4 skipped deploy ── run: git add -A && git commit, then ./scripts/update-demo.sh deploy"
fi
