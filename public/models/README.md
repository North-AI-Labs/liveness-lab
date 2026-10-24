# 模型来源、许可与恢复

Git 只保存来源清单和许可证，不保存 .task、.onnx、.pth 等权重。应用源码采用 Apache-2.0，不会改变模型自身许可。请自行阅读以下上游条款，确认用途符合要求再恢复。

| 文件 | 来源 | 用途与条款 |
| --- | --- | --- |
| face_landmarker.task | [Google 官方 float16 v1](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) | [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)；随附 MediaPipe-LICENSE.txt（Apache-2.0），以官方模型条款为准 |
| minifas-v2.onnx | [Silent-Face-Anti-Spoofing 固定提交](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/tree/b6d5f04ad78778917853b25c778acef6d5626d15) 的 2.7_80x80_MiniFASNetV2.pth | Apache-2.0，见 MiniFASNet-LICENSE.txt；本项目转换为 ONNX |
| minifas-v1se.onnx | 同一提交的 4_0_0_80x80_MiniFASNetV1SE.pth | 同上 |
| w600k_mbf.onnx | [InsightFace v0.7 buffalo_s.zip](https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip) | **预训练模型仅限非商业研究**；商业使用需另行取得授权，见 [官方许可说明](https://github.com/deepinsight/insightface/tree/master/python-package#license) |

## 首次恢复

Node 24、Python 3.11，参考根 README 创建 .venv 并安装 scripts/requirements-export.txt，再运行：

~~~powershell
npm ci
npm run assets -- --accept-model-terms
npm run check:models
npm run build
~~~

该参数表示你已确认独立模型条款，不代表项目取得了商业授权。即使默认不勾选一致性，完整资源恢复流程仍会下载研究权重；浏览器只在开启该选项时加载它。

脚本直接下载 Face Landmarker；按固定提交和 SHA-256 下载 RGB 架构 Python 与 PyTorch 权重，核验后导出；从官方 buffalo_s.zip 只读取 w600k_mbf.onnx，不解压其他文件，不执行包内代码。下载仅发生在开发机；检测页面使用本站静态文件。

已有模型可以手工放入本目录，必须匹配三份 source.json 清单的 SHA-256。脚本复用哈希正确文件，不覆盖不匹配文件、不自动重写清单。下载失败、哈希不符或缺少导出工具都会明确报错。网络必须能访问 Google Storage、raw.githubusercontent.com 和 GitHub Releases；不要改为来源不明的镜像或关闭 TLS 校验。

## 重建 RGB ONNX

~~~powershell
..venvScriptspython.exe scripts/export-models.py --accept-model-terms
~~~

固定环境见 scripts/requirements-export.txt（已在 Windows x64、Python 3.11 验证）。使用 torch.load(weights_only=True)、opset 13 和旧 TorchScript 导出器；三个输入样本对比 PyTorch / ONNX logits，rtol=1e-3、atol=3e-3，并校验最终 ONNX SHA-256。现有两份转换最大绝对误差分别约 2.86e-6 / 3.34e-6。

若不同平台或导出器导致哈希不同，应停止并检查差异；不要直接修改来源清单绕过。可使用 --output 指定忽略目录验证导出，不影响现有模型。缓存 .model-source/ 和 .cache/ 不提交。

## 前处理与局限

RGB：80×80，BGR NCHW float32 0～255，live 类索引 1，裁剪倍率分别 2.7 / 4.0。
一致性：112×112 五点对齐，RGB (pixel−127.5)/127.5，512 维 L2 特征，余弦相似度。
Face Landmarker：最多两张脸、表情系数与姿态矩阵；图像坐标和裁剪规则见技术文档。

哈希只证明文件匹配，不证明防伪效果或权利完整。模型数据、输入分布、框与五点差异、手机性能均需单独评估。不要把模型分数当作本人概率或强认证结论。
