import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

for (const variant of [
  {query:'',name:'standard ChatGPT profile'},
  {query:'?no-testid=1',name:'renamed profile selector'},
  {query:'?bad-avatar=1',name:'profile avatar style exception'},
  {query:'?plain-profile=1',name:'plain div account row without button or role'},
]) test('real Chromium sidebar mount: '+variant.name, () => {
 const chromeCandidates=['/usr/bin/google-chrome','/usr/bin/chromium','/opt/google/chrome/chrome'];
 const chrome=chromeCandidates.find(p=>existsSync(p));
 assert.ok(chrome,'Chrome or Chromium required for browser integration smoke test');
 const uri=new URL('./browser-smoke.html', import.meta.url).href + variant.query;
 const stdout=execFileSync(chrome,[
  '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
  '--allow-file-access-from-files','--window-size=1450,900',
  '--virtual-time-budget=1800','--dump-dom',uri
 ],{timeout:20000,encoding:'utf8',stdio:['ignore','pipe','ignore']});
 // HTML attributes escape quotes, so parse the printed pre element if present.
 const pre=stdout.match(/<pre id="result">([^<]+)<\/pre>/);
 assert.ok(pre,'browser fixture must emit status: '+stdout.slice(-800));
 const text=pre[1].replaceAll('&quot;','"').replaceAll('&amp;','&');
 const status=JSON.parse(text);
 assert.equal(status.rootConnected,true,'sidebar root must remain mounted');
 assert.equal(status.placement,'sidebar','regular chat must use sidebar placement');
 assert.equal(status.sessionFetchCount,1,'initial render must start session fetch');
 assert.equal(status.usageFetchCount,1,'initial render must reach quota API');
 assert.deepEqual(status.exceptions,[],'no uncaught JavaScript exception during mount');
 assert.equal(status.triggerVisible,true,'quota trigger must be visibly rendered');
 assert.equal(status.popupOpens,true,'clicking quota icon must open popup');
 assert.equal(status.popupCloses,true,'clicking the same icon must close popup');
 assert.ok(Math.abs(status.iconCenter-status.avatarCenter)<=4,
   'quota ring must align with profile avatar: '+JSON.stringify(status));
 assert.ok(Math.abs(status.labelLeft-status.usernameLeft)<=6,
   'quota label must align with username: '+JSON.stringify(status));
});