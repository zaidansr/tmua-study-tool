'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname,'../web/theme.js'),'utf8');
function browser({saved,systemDark=false,denied=false}={}) {
  const root={dataset:{}}, events={}, mediaEvents={}, buttonEvents={}, attributes={}, meta={}, messages=[];
  const storage=new Map(saved===undefined?[]:[['tmua-theme-v1',saved]]);
  const media={matches:systemDark,addEventListener:(name,fn)=>mediaEvents[name]=fn};
  const button={setAttribute:(name,value)=>attributes[name]=value,addEventListener:(name,fn)=>buttonEvents[name]=fn};
  const context={document:{documentElement:root,querySelector:()=>({setAttribute:(name,value)=>meta[name]=value}),getElementById:()=>button,addEventListener:(name,fn)=>events[name]=fn},window:{matchMedia:()=>media,addEventListener:(name,fn)=>events[name]=fn},localStorage:{getItem:key=>{if(denied)throw Error('denied');return storage.get(key);},setItem:(key,value)=>{if(denied)throw Error('denied');storage.set(key,value);}}};
  vm.runInNewContext(code,context);
  context.window.chrome={webview:{postMessage:message=>messages.push(message)}};
  return {root,storage,attributes,meta,messages,ready:()=>events.DOMContentLoaded(),click:()=>buttonEvents.click(),system(value){media.matches=value;mediaEvents.change();},sync(key,newValue){events.storage({key,newValue});}};
}
test('the resolved saved theme is shared with Windows startup and follows theme changes',()=>{
  const h=browser({saved:'dark',systemDark:false});h.ready();
  assert.equal(h.messages.at(-1).type,'theme-changed');assert.equal(h.messages.at(-1).theme,'dark');
  h.click();assert.equal(h.messages.at(-1).theme,'light');
  const next=browser({saved:h.storage.get('tmua-theme-v1'),systemDark:true});next.ready();assert.equal(next.messages.at(-1).theme,'light');
});
test('first visit follows system theme before controls load and responds to system changes',()=>{
  const h=browser({systemDark:true});assert.equal(h.root.dataset.theme,'dark');assert.equal(h.meta.content,'#171717');h.ready();assert.equal(h.attributes['aria-pressed'],'true');
  h.system(false);assert.equal(h.root.dataset.theme,'light');assert.equal(h.attributes['aria-pressed'],'false');
});
test('toggle persists an explicit preference across reload and overrides system changes',()=>{
  const h=browser();h.ready();h.click();assert.equal(h.root.dataset.theme,'dark');assert.equal(h.storage.get('tmua-theme-v1'),'dark');
  h.system(false);assert.equal(h.root.dataset.theme,'dark');const next=browser({saved:h.storage.get('tmua-theme-v1')});assert.equal(next.root.dataset.theme,'dark');next.ready();next.click();assert.equal(next.storage.get('tmua-theme-v1'),'light');
});
test('blocked storage still allows toggling within the current session',()=>{
  const h=browser({denied:true});h.ready();h.click();assert.equal(h.root.dataset.theme,'dark');h.click();assert.equal(h.root.dataset.theme,'light');
});
test('theme synchronizes between tabs and clearing it restores the system preference',()=>{
  const h=browser();h.ready();h.sync('tmua-theme-v1','dark');assert.equal(h.root.dataset.theme,'dark');h.sync('unrelated','light');assert.equal(h.root.dataset.theme,'dark');h.sync('tmua-theme-v1',null);assert.equal(h.root.dataset.theme,'light');h.system(true);assert.equal(h.root.dataset.theme,'dark');h.sync(null,null);assert.equal(h.root.dataset.theme,'dark');
});
test('invalid saved values use the system theme and toggling does not change study data',()=>{
  const h=browser({saved:'invalid',systemDark:true});h.storage.set('tmua-progress-example','preserved');h.ready();h.click();assert.equal(h.storage.get('tmua-progress-example'),'preserved');assert.equal(h.root.dataset.theme,'light');
});
