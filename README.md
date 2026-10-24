# 北智技术实验室·H5活体检测

[North-AI-Labs/liveness-lab](https://github.com/North-AI-Labs/liveness-lab) 是独立的 H5 / JavaScript 活体检测实验项目。随机动作、RGB 轻量防伪、正脸优选、静音录像及可选会话内人脸一致性校验均在浏览器内完成。检测页没有上传接口、不使用麦克风，不接入实名核身服务。

项目用于学习、设备适配与非商业研究；不能作为实名开户等强认证的唯一依据。纯前端结果可被篡改，动作和 RGB 检查不能保证抵御视频回放、面具、实时换脸或相机注入。阈值尚未进行业务标定。

## 快速开始

推荐 Node.js 24；依赖要求 Node.js 20.19+ 或 22.12+。首次恢复模型需 Python 3.11。Python 和 Node 只用于开发工具，部署后的检测不需要它们。

源码仓库**不包含模型权重、WASM 和人物测试照片**。请先阅读 [模型来源、许可与恢复说明](public/models/README.md)，再执行：

~~~powershell
git clone git@github.com:North-AI-Labs/liveness-lab.git
cd liveness-lab
npm ci

# 首次恢复两个 RGB 模型需要本地导出环境，安装可能较大。
python -m venv .venv
..venvScriptspython.exe -m pip install -r scripts/requirements-export.txt
npm run assets -- --accept-model-terms

npm run dev
~~~

macOS / Linux 的 Python 路径为 .venv/bin/python；固定 CPU 导出环境已在 Windows x64 / Python 3.11 验证，其他平台需确认对应 wheel 可用。资源脚本优先使用 LIVENESS_PYTHON，其次本目录虚拟环境，最后系统 python。缺少模型时会从固定来源恢复并核验 SHA-256；已有文件哈希不符会报错，不覆盖。

在本机打开 [检测页](http://127.0.0.1:5175/)。初次加载全部基础模型后点击“开始活体检测”，再授权相机；本机 localhost / 127.0.0.1 可用 HTTP，手机局域网相机需可信 HTTPS。

首页底部中间的“技术说明文档”在新标签页打开，包含 19 节初学者说明；源码为 [public/technical-guide.html](public/technical-guide.html)。

## 检测流程

1. 从“点头、向左转头、向右转头、眨眼、张嘴”无重复随机抽取两个，使用浏览器加密随机数，共 20 种有序组合；左右按被摄者自己的方向。
2. 检查单人、面部尺寸、完整入镜、曝光、清晰度和自然正脸。准备阶段至少 6 个有效 RGB 融合样本，校准自然姿态。
3. 每个动作依次经历自然正脸、连续多帧动作、恢复正脸；单帧动作不能通过。预置中文 WAV 提示可关闭或重播，不调用在线语音。
4. 动作后重新检查正脸和 RGB。优选睁眼、闭嘴、姿态与质量合格的同一原始视频帧。
5. 输出 portrait.jpg（约 3:4 原始方向裁剪）、original.jpg（原始帧）和 report.json（动作、质量、RGB、裁剪和关键点记录）。预览镜像，导出不镜像、不美颜、不主动放大。
6. 相机播放后使用 MediaRecorder 同步静音录像，通过、失败、停止或切后台后结束；支持本页回放和下载。优先 MP4，其次 WebM / 浏览器默认格式，内存上限 64 MB。录像可用不代表检测通过。

默认 RGB 阈值 0.80、清晰度下限 35（128×128 面部灰度拉普拉斯方差）。准备与截照阶段分别至少 6 个 RGB 样本，中位数达标且至少 75% 达标；8 个样本仍不足则拒绝。失败、超时、多人、丢脸、视频中断或切后台不输出通过照片。照片、视频、特征在本次页面内存处理；用户自行下载后才落盘。

## 会话内人脸一致性（默认关闭）

勾选后加载 MobileFaceNet，使用 MediaPipe 五点近似对齐到 112×112、RGB (pixel−127.5)/127.5，提取 512 维 L2 特征，以余弦相似度比较。准备阶段建立至少 3 份相互一致、跨度 800 ms 的固定参考；通常每 500 ms 抽检，两个动作开始及回正共四个检查点、最终照片均要求新鲜同帧证据。

默认比较门槛 0.45、参考间门槛 0.55，均未标定。首次不匹配暂停，连续两次不匹配失败；质量差属未知，参考建立后超过 2 秒未确认失败。报告只保留分数与时间，不包含向量；结束清零参考。关闭时不加载或运行该模型。

这是会话内抽样比较，不是证件照片比对，也无法证明采样间每一瞬间的身份。预训练权重仅限非商业研究，商业使用需取得上游授权，详见 [InsightFace 官方说明](https://github.com/deepinsight/insightface/tree/master/python-package#license)。

## 技术与开源来源

| 项目 | 固定版本 / 来源 | 用途 | 上游许可 |
| --- | --- | --- | --- |
| [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) | 0.10.32；Face Landmarker float16 v1 | 人脸关键点、表情系数和姿态矩阵，最多检测两人 | Apache-2.0；模型说明见清单 |
| [Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/tree/b6d5f04ad78778917853b25c778acef6d5626d15) | b6d5f04；MiniFASNetV2 + V1SE | RGB 图像轻量防伪 | Apache-2.0，上游声明见模型目录 |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | 1.22.0 | 单线程 CPU WASM 推理 | MIT 及第三方声明 |
| [InsightFace](https://github.com/deepinsight/insightface) | v0.7 buffalo_s / w600k_mbf.onnx | 可选会话内人脸特征 | 代码 MIT；预训练模型仅限非商业研究 |
| [Vite](https://github.com/vitejs/vite) / [esbuild](https://github.com/evanw/esbuild) | 7.3.7 / 0.28.1 | 开发与构建 | MIT |
| PyTorch / ONNX / ONNX Runtime / NumPy | scripts/requirements-export.txt | 仅开发时转换与核验 RGB 模型 | 各自上游许可，不进入浏览器 |

RGB 是可见光模型防伪，不是肤色判断或闪屏挑战。V2 / V1SE 分别按 2.7 / 4.0 倍扩边裁剪到 80×80，输入 BGR、NCHW、float32、0～255；对 logits 执行 softmax，索引 1 为 live，再平均两个模型。不能误用 0～1 输入或索引 0。

优先经典 Worker + OffscreenCanvas，不支持时尝试主线程；所有基础模型必须正常加载，不静默跳过 RGB。MediaPipe 人脸框、五点与上游检测器有差异，Canvas 和 OpenCV 插值也可能不同，导出数值一致不等于浏览器完整前处理或防伪准确率一致。

模型清单分别在 [mediapipe-source.json](public/models/mediapipe-source.json)、[rgb-source.json](public/models/rgb-source.json)、[identity-source.json](public/models/identity-source.json)。详细权利说明见 [第三方声明](public/THIRD_PARTY_NOTICES.txt)。中文提示使用本地 Windows 语音合成预生成，不含用户录音；修改文案可在安装 zh-CN 语音的 Windows PowerShell 中运行 scripts/generate-prompts.ps1。

## 手机 HTTPS 测试与部署

项目自带独立测试证书生成工具，不依赖相邻工程：

~~~powershell
..venvScriptspython.exe -m pip install -r scripts/requirements-cert.txt
..venvScriptspython.exe scripts/create-lan-cert.py 192.168.1.100
npm run build
npm run dev:lan -- 192.168.1.100
~~~

替换为电脑当前局域网 IPv4；手机和电脑连接同一 Wi-Fi。手机入口 https://你的IP:8445/，证书引导 http://你的IP:8085/。默认读取 .certs/ 中 server.pem、server-key.pem、ca.cer，只监听指定网卡并拒绝不同子网，不自动修改防火墙和系统信任。需手动信任 CA；iPhone 还需在“证书信任设置”开启完全信任，测试结束可移除。

已有证书可用环境变量 LIVENESS_TLS_DIR 指定目录，CA 文件名可用 LIVENESS_TLS_CA 指定（默认 ca.cer）。证书必须包含当前 IP 且未过期。不要把证书或私钥放进 public/、dist/ 或 Git。

正式静态测试把整个 dist/ 部署到可信 HTTPS 站点，保留 models/、vendor/、audio/ 和许可证。无需 API、Go 服务或数据库。子路径部署先设置 LIVENESS_LAB_BASE=/liveness/ 再构建；服务器应返回正确 WASM / 模型文件，不能将缺失资源改写为首页。

## 目录与验证

- index.html、src/：界面、动作状态机、模型推理、身份一致性、录像和照片导出。
- public/：技术文档、原始语音提示、模型来源清单和许可证。
- scripts/：模型恢复、校验、构建、HTTPS 测试与发布索引检查。
- tests/：状态机、质量、前处理、音频、录像和身份一致性测试；人物图片自行准备，见 tests/fixtures/README.md。
- docs/PUBLISHING.md：发布范围、干净副本验证与推送步骤。

~~~powershell
npm test
npm run check:models
npm run build
# 暂存后检查待提交文件
git add .
npm run check:publish
~~~

尚未恢复模型时可运行 npm test 和 npm run build:source。后者只检查源码打包，缺模型的 dist 无法用于检测，不能部署为可用演示。正式 npm run build 会强制核验全部四个模型；不会自动下载模型。GitHub Actions 仅做源码、逻辑测试、打包及发布范围检查，不下载受限权重。

开发环境 /tests/browser.html、/tests/identity.html 使用本地授权照片检查真实推理；/tests/recording.html 用动态图案检查实际编码和解码。它们不构建到 dist。自动化检查不代替微信、Safari、Android 浏览器真机测试与独立攻击评估。

## 许可与仓库范围

本项目原创源码与文档采用 [Apache License 2.0](LICENSE)，声明见 [NOTICE](NOTICE)。第三方模型和组件保留各自许可，源码许可不授予受限权重的商业使用权。

仓库排除模型、下载缓存、WASM、生成 Worker、node_modules、dist、测试图片、用户照片录像、证书、私钥、环境变量和本地业务适配器。预置界面语音保留，确保下载源码后可恢复原有提示体验。本地可选业务入口不属于公开项目，新克隆只构建实验室页面。
