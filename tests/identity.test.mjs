import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceIdentityGuard } from '../src/identity-guard.js';
import { identityTensor, similarityTransform, TEMPLATE, fivePoints, cosine } from '../src/identity-math.js';
import { ACTIONS, LivenessSession } from '../src/core.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

const feature = (index = 0) => Float32Array.from({ length: 512 }, (_, i) => i === index ? 1 : 0);
const metric = (t, embedding, extra = {}) => ({ count: 1, t, box: { x: 300, y: 150, w: 300, h: 340 }, ratio: .35, edge: false, brightness: 130, darkRatio: 0, brightRatio: 0, sharpness: 100, yaw: 0, pitch: 0, roll: 0, blink: 0, blinkLeft: 0, blinkRight: 0, jaw: 0, rgb: { t, score: .95, scores: [.95, .95] }, ...(embedding ? { identity: { t, embedding } } : {}), ...extra });
const update = (g, t, e = feature(), valid = true) => g.update(metric(t, e), t, { valid, referenceAllowed: true });
function prepared() { const g = new FaceIdentityGuard(); [100, 600, 1100].forEach(t => update(g, t)); assert.ok(g.ready); return g; }

test('一致性输入为 RGB [-1,1]，不能复用防伪 BGR 0..255', () => {
  const data=identityTensor(new Uint8Array([255,127,0,255])); assert.equal(data[0],1);assert.equal(data[2],-1);assert.ok(Math.abs(data[1]+1/255)<1e-7);
});
test('五点相似变换保留方向并映射到 112 模板', () => {
  const source = TEMPLATE.map(([x, y]) => [x * 2 + 10, y * 2 + 20]); const [a,b,c,d,e,f] = similarityTransform(source);
  source.forEach(([x,y],i)=>{ assert.ok(Math.abs(a*x+c*y+e-TEMPLATE[i][0])<1e-6); assert.ok(Math.abs(b*x+d*y+f-TEMPLATE[i][1])<1e-6); });
  assert.throws(()=>similarityTransform(Array(5).fill([0,0])));
  assert.throws(()=>fivePoints([],640,480));
});
test('固定三个参考需时间跨度与相互一致，混合人脸直接失败', () => {
  const g = new FaceIdentityGuard(); update(g,100); update(g,400); update(g,700); assert.equal(g.ready,false); update(g,1000); assert.ok(g.ready);
  const bad = new FaceIdentityGuard(); update(bad,100); update(bad,600,feature(1)); assert.equal(bad.status,'failed');
});
test('第一帧低相似度暂停，连续两帧不匹配失败，不靠旧分数继续', () => {
  const g = prepared(); update(g,1600,feature(1)); assert.equal(g.status,'mismatch'); assert.equal(g.ready,false);
  g.update(metric(1700),1700,{valid:true}); assert.equal(g.ready,false);
  update(g,1800,feature(1)); assert.equal(g.status,'failed');
});
test('单次低分后仅新的合格匹配能恢复，不改变固定模板', () => {
  const g = prepared(), original=[...g.reference]; update(g,1600,feature(1)); update(g,1800);
  assert.ok(g.ready); assert.deepEqual([...g.reference],original); assert.equal(g.mismatches,0);
});
test('模糊和大姿态是未知而非不同人，超过最大未确认间隔失败', () => {
  const g = prepared(); update(g,1600,feature(),false); assert.equal(g.status,'unknown'); assert.equal(g.checks.length,0);
  update(g,3200); assert.equal(g.status,'failed'); assert.ok(g.maxGapMs>2000);
});
test('旧时间戳特征不能当成当前帧、动作检查点或最终照片证据', () => {
  const g = prepared(); update(g,1600); assert.ok(g.checkpoint('action-0-start',1600));
  assert.equal(g.checkpoint('action-0-end',1700),false);
  const m=metric(1700); m.identity={...g.frameSummary(1600)}; assert.equal(g.approvesPhoto(m),false);
});
test('位置突然跳变需要新特征复核，轨迹相邻不能替代身份', () => {
  const g=prepared(); update(g,1600);
  const m=metric(1700,null,{box:{x:900,y:150,w:300,h:340}}); g.update(m,1700,{valid:true});
  assert.equal(g.ready,false); assert.ok(g.force);
});
test('报告不包含特征向量，结束清零固定参考与样本', () => {
  const g=prepared(); update(g,1600); const vector=g.reference;
  assert.equal(JSON.stringify(g.report()).includes('embedding'),false);
  g.clearSensitive(); assert.equal(g.reference,null); assert.equal(g.accepted.size,0); assert.ok(vector.every(x=>x===0));
});
function rig(enabled=true) {
  const session=new LivenessSession(['left','mouth'].map(id=>ACTIONS.find(a=>a.id===id)),{identityEnabled:enabled}); let t=0,last=-Infinity, current;
  const step=(extra={},e=feature())=>{
    t+=100; const due=enabled&&(session.identity.force||t-last>=500||session.phase==='capture');
    current=metric(t,due?e:null,extra); if(due)last=t;
    session.update(current,t); return current;
  };
  const repeat=(n,extra={},e)=>{for(let i=0;i<n;i++)step(extra,e);};
  const prepare=()=>{for(let i=0;i<40&&session.phase==='prepare';i++)step(); assert.equal(session.phase,'action');};
  return {session,step,repeat,prepare,now:()=>t,current:()=>current};
}
test('可选关闭时不需要参考、特征或检查点', () => { const r=rig(false); r.prepare(); assert.equal(r.session.identity,null); });
test('开启后无特征不能离开准备阶段', () => { const r=rig(); r.repeat(30,{},null); assert.equal(r.session.phase,'prepare'); });
test('全流程必须有四个新鲜检查点及同一照片帧身份结果', () => {
  const r=rig(); r.prepare();
  for(const motion of [{yaw:25},{jaw:.7}]){r.repeat(15);assert.equal(r.session.subphase,'perform');r.repeat(5,motion);r.repeat(6);}
  assert.equal(r.session.phase,'capture'); r.repeat(18);
  assert.equal(r.session.identity.checkpoints.length,4);
  assert.equal(r.session.finishCapture(true,r.now()),false);
  assert.equal(r.session.finishCapture(true,r.now(),{...r.current(),t:r.now()-1}),false);
  assert.equal(r.session.finishCapture(true,r.now(),r.current()),true);
  assert.equal(r.session.identity.status,'passed');
});
test('动作中换成不同人，不能完成该动作', () => {
  const r=rig();r.prepare();r.repeat(15);r.repeat(10,{yaw:25},feature(1));assert.equal(r.session.phase,'failed');assert.equal(r.session.completed.length,0);
});
test('参考建立后即使仍在准备阶段，无脸超过身份间隔也必须失败',()=>{
  const session=new LivenessSession(['left','mouth'].map(id=>ACTIONS.find(a=>a.id===id)),{identityEnabled:true});
  session.identity=prepared();session.last=1100;session.started=100;session.phaseStarted=100;
  for(let t=1200;t<=3200;t+=100)session.update({count:0},t);
  assert.equal(session.phase,'failed');assert.match(session.reason,/一致性/);
});
test('一致性模型来源与固定清单包含许可及校验信息',async()=>{
  const source=JSON.parse(await readFile(new URL('../public/models/identity-source.json',import.meta.url),'utf8'));
  assert.equal(source.bytes,13616099); assert.match(source.sha256,/^[a-f0-9]{64}$/);
  assert.match(source.license,/non-commercial/); assert.ok(cosine(feature(),feature())>.999);
});
test('本地一致性模型文件大小和 SHA-256 与固定清单一致',{skip:!existsSync(new URL('../public/models/w600k_mbf.onnx',import.meta.url))},async()=>{
  const source=JSON.parse(await readFile(new URL('../public/models/identity-source.json',import.meta.url),'utf8'));
  const data=await readFile(new URL(`../public/models/${source.file}`,import.meta.url));
  assert.equal(data.length,source.bytes); assert.equal(createHash('sha256').update(data).digest('hex'),source.sha256);
});
