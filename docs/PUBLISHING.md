# 源码整理与发布

本仓库是独立浏览器实验室，沿用 face-compare-lab 的源码发布方式：Apache-2.0、受限模型分离、可恢复资源、干净副本验证、发布索引检查。模型权利独立于源码许可。

## 提交范围

提交应用源码、单元测试、19 节技术文档、预置中文提示音、模型来源和哈希、许可证、资源脚本、锁定依赖与 CI。

不提交模型权重、WASM、生成 Worker、依赖、构建产物、Python 虚拟环境、下载缓存、验证截图、人物测试图、实际检测照片录像、证书私钥、环境变量、本地业务页面和适配器。文件仍可留在本地，由 .gitignore 排除。

src/capture-evidence.js 是实验室选帧共用代码，应保留；capture.html、capture-page.js、capture-controller.js、capture.css、capture-zoom.js 和对应业务测试为本地扩展，不公开。Vite 仅在本地存在该入口时额外构建，新克隆默认只有 index.html。

## 发布前检查

~~~powershell
npm ci
npm test
npm run check:models
npm run build
git add .
npm run check:publish
git diff --cached --stat
git diff --cached
~~~

检查器读取 Git 暂存区，拒绝常见隐私文件、模型、证书、凭据和超大文件；允许清单内预置 WAV。它不能代替人工确认。不要用 git add -f 绕过。

## 干净副本验证

将待发布 Git 索引导出到全新临时目录，或从本地提交克隆一份。不要从整个工作目录复制，否则会混入被忽略文件。

1. npm ci：只使用 lockfile 安装。
2. npm test：应通过纯逻辑测试；缺少一致性权重时仅对应的二进制哈希用例明确 skip。
3. npm run build:source：检查缺模型也可进行源码打包，dist 无法用于检测。
4. npm run build：缺权重应失败并给出恢复提示。
5. 阅读模型条款、创建 Python 导出环境，运行 npm run assets -- --accept-model-terms，或显式放入已验证的同哈希模型。
6. npm run check:models、npm test、npm run build：验证完整本地资源和正式打包。
7. 确认不存在业务 capture.html / Go 后端、私有 API 或相邻工程依赖。

GitHub Actions 运行无模型源码检查，不恢复受限研究权重、不访问相机、不上传样本，也不证明真机防伪效果。

## 推送与源码包

~~~powershell
git commit -m "Publish standalone H5 liveness lab"
git remote add github git@github.com:North-AI-Labs/liveness-lab.git
git push -u github main
git rev-parse HEAD
git ls-remote github refs/heads/main
git status --short
git archive --format=zip --output=artifacts/liveness-lab-source.zip HEAD
~~~

远端非空时先获取并审阅历史，不强推覆盖。SSH 维持严格主机校验，认证信息留在本机。源码包来自已提交 Git 树，不包含本地模型；GitHub 源码下载同样需要按 README 恢复资源。源码包及验证产物只放在被忽略的 artifacts/ 中。
