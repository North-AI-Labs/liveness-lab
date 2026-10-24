import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeClient } from '../src/runtime-client.js';

test('兼容模式停止后切换选项，先等旧帧完成再释放识别模型',async()=>{
  const client=new RuntimeClient(),events=[];let release;
  client.runtime={analyze:async()=>{events.push('frame-start');await new Promise(resolve=>release=resolve);events.push('frame-end');return{};},configureIdentity:async()=>events.push('disable'),close:()=>events.push('close')};
  const frame=client.frame({},100,{enabled:true});await Promise.resolve();
  const disabled=client.configureIdentity(false);assert.deepEqual(events,['frame-start']);
  release();await frame;await disabled;assert.deepEqual(events,['frame-start','frame-end','disable']);
  client.close();await client.serialQueue;await Promise.resolve();assert.equal(events.at(-1),'close');
});
test('关闭后迟到的身份模型任务被取消，不再执行',async()=>{
  const client=new RuntimeClient();let called=false;
  client.runtime={configureIdentity:async()=>{called=true;},close:()=>{}};
  const pending=client.configureIdentity(true);client.close();
  await assert.rejects(pending,/页面已关闭/);assert.equal(called,false);
});
