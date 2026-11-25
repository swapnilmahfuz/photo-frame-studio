import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';

const project = 'kuetconvocationphotoframe27';
const filename = new URL('../public/art/kuet-starter.png',import.meta.url);
const png = await readFile(filename);
const json = JSON.stringify('data:image/png;base64,'+png.toString('base64'));
const databaseURL = 'https://studio-transfer-test.firebaseio.com';
const fetchOriginal = globalThis.fetch;
const server = createServer((req,res)=>{
  res.writeHead(200,{'Content-Type':'application/json'});
  res.write(json.slice(0,1));
  let offset = 1;
  const timer = setInterval(()=>{
    const next = Math.min(offset+Math.ceil(json.length/7),json.length);
    res.write(json.slice(offset,next));
    offset = next;
    if (offset===json.length) res.end();
  },3100);
  res.on('close',()=>clearInterval(timer));
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const origin = 'http://127.0.0.1:'+server.address().port;
globalThis.location = {origin};
globalThis.fetch = (url,options) => {
  if (url === '/firebase-config.json') {
    return Promise.resolve(Response.json({projectId:project,databaseURL}));
  }
  const remote = new URL(url);
  assert.equal(remote.origin,databaseURL);
  return fetchOriginal(origin+remote.pathname,options);
};
const slug = 'kuet-4th-convocation-2027';
const frame = {id:'frame',version:'version'};
const start = Date.now();
try {
  const {asset} = await import('../public/firebase-data.js');
  const verified = asset(slug,frame,'full').then(async result=>{
    assert.deepEqual(Buffer.from(await result.arrayBuffer()),png);
    assert.ok(Date.now()-start>20000);
    console.log('Full PNG passed a continuously progressing transfer beyond 20 seconds.');
  });
  if (process.env.BASELINE_ART_MODULE) {
    const {asset:oldAsset} = await import(pathToFileURL(process.env.BASELINE_ART_MODULE).href);
    await Promise.all([verified,assert.rejects(oldAsset(slug,frame,'full')).then(()=>{
      console.log('Old loader failed on the same slow transfer.');
    })]);
  } else await verified;
} finally {
  globalThis.fetch = fetchOriginal;
  server.close();
  server.closeAllConnections();
}
