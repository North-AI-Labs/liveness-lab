import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import * as ort from 'onnxruntime-web/wasm';
import { bgrTensor, liveScore, poseFromMatrix, imageQuality, scaledCrop, frontal, neutral, qualityIssue } from './core.js';
import { fivePoints, similarityTransform, identityTensor, normalize } from './identity-math.js';

function canvas(size) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  const element = document.createElement('canvas'); element.width = size; element.height = size; return element;
}

export class VisionRuntime {
  close() { this.closed = true; this.face?.close(); for (const model of this.models || []) model.session.release(); this.models = []; this.identityModel?.release(); this.identityModel = null; }
  async configureIdentity(enabled) {
    if (this.closed) throw new Error('检测页面已关闭');
    this.lastIdentity = -Infinity;
    if (!enabled) { await this.identityModel?.release(); this.identityModel = null; return { enabled: false }; }
    if (!this.identityModel) {
      const model = await ort.InferenceSession.create(`${this.base}models/w600k_mbf.onnx`, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      if (this.closed) { await model.release(); throw new Error('检测页面已关闭'); }
      this.identityModel = model;
      this.aligned = canvas(112); this.alignedCtx = this.aligned.getContext('2d', { willReadFrequently: true });
    }
    return { enabled: true, model: 'MobileFaceNet', dimensions: 512 };
  }
  async embedding(image, m) {
    if (!this.identityModel) throw new Error('一致性模型未加载，不能执行已勾选的校验');
    const transform = similarityTransform(fivePoints(m.landmarks, image.width, image.height)), ctx = this.alignedCtx;
    ctx.resetTransform(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 112, 112);
    ctx.setTransform(...transform); ctx.drawImage(image, 0, 0); ctx.resetTransform();
    const tensor = new ort.Tensor('float32', identityTensor(ctx.getImageData(0, 0, 112, 112).data), [1, 3, 112, 112]);
    let output;
    try {
      output = await this.identityModel.run({ [this.identityModel.inputNames[0]]: tensor });
      const embedding = normalize(output[this.identityModel.outputNames[0]].data);
      if (embedding.length !== 512) throw new Error('一致性模型输出维度不符');
      return embedding;
    } finally { tensor.dispose(); if (output) Object.values(output).forEach(value => value.dispose()); }
  }
  async init(base, notify = () => {}) {
    this.base = base; this.lastRGB = -Infinity; this.lastTimestamp = 0;
    notify('正在加载人脸关键点模型');
    const files = await FilesetResolver.forVisionTasks(`${base}vendor/mediapipe`);
    this.face = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: `${base}models/face_landmarker.task`, delegate: 'CPU' },
      runningMode: 'VIDEO', numFaces: 2, minFaceDetectionConfidence: 0.6,
      minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    });
    notify('正在加载双模型 RGB 防伪');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = `${base}vendor/ort/`;
    this.models = [];
    for (const [file, scale] of [['minifas-v2.onnx', 2.7], ['minifas-v1se.onnx', 4]]) {
      const session = await ort.InferenceSession.create(`${base}models/${file}`, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      this.models.push({ session, scale });
    }
    this.small = canvas(80); this.smallCtx = this.small.getContext('2d', { willReadFrequently: true });
    this.quality = canvas(128); this.qualityCtx = this.quality.getContext('2d', { willReadFrequently: true });
    notify('全部模型已就绪');
  }
  async rgb(image, box) {
    const scores = [];
    for (const { session, scale } of this.models) {
      const crop = scaledCrop(box, image.width, image.height, scale);
      this.smallCtx.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, 80, 80);
      const input = new ort.Tensor('float32', bgrTensor(this.smallCtx.getImageData(0, 0, 80, 80).data), [1, 3, 80, 80]);
      const result = await session.run({ [session.inputNames[0]]: input });
      scores.push(liveScore(result[session.outputNames[0]].data));
      input.dispose(); Object.values(result).forEach((v) => v.dispose());
    }
    return { score: (scores[0] + scores[1]) / 2, scores };
  }
  async analyze(image, t, forceRGB = false, identity = {}) {
    const started = performance.now();
    this.lastTimestamp = Math.max(t, this.lastTimestamp + 1);
    const result = this.face.detectForVideo(image, this.lastTimestamp);
    const count = result.faceLandmarks.length;
    if (count !== 1) return { count, t, duration: performance.now() - started };
    const points = result.faceLandmarks[0];
    const categories = Object.fromEntries(result.faceBlendshapes[0].categories.map((c) => [c.categoryName, c.score]));
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys), right = Math.max(...xs), bottom = Math.max(...ys);
    const box = { x: x * image.width, y: y * image.height, w: (right - x) * image.width, h: (bottom - y) * image.height };
    this.qualityCtx.drawImage(image, box.x, box.y, box.w, box.h, 0, 0, 128, 128);
    const quality = imageQuality(this.qualityCtx.getImageData(0, 0, 128, 128).data, 128);
    const m = {
      count, t, box, ...poseFromMatrix(result.facialTransformationMatrixes[0].data), ...quality,
      ratio: box.w / image.width, edge: x < 0.04 || y < 0.04 || right > 0.96 || bottom > 0.96,
      blinkLeft: categories.eyeBlinkLeft ?? 0, blinkRight: categories.eyeBlinkRight ?? 0,
      blink: Math.max(categories.eyeBlinkLeft ?? 0, categories.eyeBlinkRight ?? 0), jaw: categories.jawOpen ?? 0,
      landmarks: [33, 133, 362, 263, 1, 61, 291].map((i) => ({ index: i, x: points[i].x, y: points[i].y })),
    };
    const identityEligible = identity.enabled && !qualityIssue(m, identity.settings || { sharpness: 35 }) && Math.abs(m.yaw) < 42 && Math.abs(m.pitch) < 35 && Math.abs(m.roll) < 18 && (!identity.reference || neutral(m));
    const identityDue = identityEligible && (identity.force || t - (this.lastIdentity ?? -Infinity) >= 500 || (identity.capture && t - this.lastRGB >= 300));
    if ((forceRGB || t - this.lastRGB >= 300 || (identityDue && identity.reference)) && frontal(m) && m.blink < 0.3 && m.jaw < 0.22) {
      m.rgb = { ...await this.rgb(image, box), t };
      this.lastRGB = t;
    }
    if (identityDue) { m.identity = { t, embedding: await this.embedding(image, m) }; this.lastIdentity = t; }
    m.duration = performance.now() - started;
    return m;
  }
  async diagnostic() {
    const blank = canvas(640); const ctx = blank.getContext('2d'); ctx.fillStyle = '#909090'; ctx.fillRect(0, 0, 640, 640);
    this.lastTimestamp = Math.max(performance.now(), this.lastTimestamp + 1);
    const face = this.face.detectForVideo(blank, this.lastTimestamp);
    const rgb = await this.rgb(blank, { x: 210, y: 180, w: 180, h: 230 });
    return { faceCount: face.faceLandmarks.length, rgb, models: this.models.length, backend: 'WASM / CPU', note: '灰色测试图仅验证真实推理链路，不作为活体结果' };
  }
}
