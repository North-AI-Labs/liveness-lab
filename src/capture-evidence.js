import { clamp, neutral, qualityIssue } from './core.js';

// Shared by the laboratory and the business capture page. Both select the same
// fresh RGB/quality-approved original frame and the same unmirrored 3:4 crop.
export function selectFaceCandidate(frame, metrics, session, previous, t) {
  if (!session.captureReady || !neutral(metrics) || qualityIssue(metrics, session.settings) || !metrics.rgb || metrics.rgb.t !== t) return previous;
  if (session.identity && !session.identity.approvesPhoto(metrics)) return previous;
  const m = metrics;
  const score = Math.min(m.sharpness, 700) / 700 * .45 + (1 - Math.min(Math.abs(m.yaw) + Math.abs(m.pitch) + Math.abs(m.roll), 36) / 36) * .3 + (1 - Math.abs(m.brightness - 135) / 135) * .15 + m.rgb.score * .1;
  if (previous && score <= previous.score) return previous;
  const original = document.createElement('canvas'); original.width = frame.width; original.height = frame.height;
  original.getContext('2d').drawImage(frame, 0, 0);
  const w = Math.min(m.box.w * 1.8, frame.width, frame.height * .75), h = w / .75;
  const crop = { x: Math.round(clamp(m.box.x + m.box.w / 2 - w / 2, 0, frame.width - w)), y: Math.round(clamp(m.box.y - m.box.h * .3, 0, frame.height - h)), w: Math.floor(w), h: Math.floor(h) };
  const portrait = document.createElement('canvas'); portrait.width = crop.w; portrait.height = crop.h;
  portrait.getContext('2d').drawImage(original, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  return { original, portrait, crop, score, metrics: structuredClone(m), t };
}
export const jpegBlob = (canvas) => new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('照片编码失败，请重新检测')), 'image/jpeg', .95));

export function detectionReport(session, selected, recording, outcome, reason = '') {
  const m = selected.metrics || {};
  return {
    schema: 'beizhi-liveness/v1', outcome, reason,
    actions: session.actions.map(a => a.id), completedActions: [...session.completed],
    settings: session.settings, events: session.events,
    rgb: { before: session.pre, after: session.post, photoFrame: m.rgb || { score: 0, scores: [] } },
    quality: { brightness: m.brightness || 0, sharpness: m.sharpness || 0, yaw: m.yaw || 0, pitch: m.pitch || 0, roll: m.roll || 0 },
    photo: { mirrored: false, originalWidth: selected.original.width, originalHeight: selected.original.height, portraitCrop: selected.crop },
    recording: { status: recording.status, durationMs: recording.durationMs, hasAudio: recording.hasAudio },
    identity: session.identity ? { ...session.identity.report(), finalPhoto: m.identity || null } : { enabled: false, status: 'not_evaluated' },
    source: 'browser_report',
  };
}
