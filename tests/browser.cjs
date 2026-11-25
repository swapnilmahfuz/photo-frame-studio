const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const {createMockUserToken} = require('@firebase/util');

const project = 'kuetconvocationphotoframe27';
const demo = 'demo-photo-frame-studio';
const owner = 'swapnilmahfuz20@gmail.com';
const claims = {sub:'owner',email:owner,email_verified:true,firebase:{sign_in_provider:'google.com',identities:{}}};
const token = createMockUserToken(claims,demo);
const port = 9197;
const firestore = 'http://127.0.0.1:8187';
const database = 'http://127.0.0.1:'+port;
const dbHost = 'https://demo-photo-frame-studio.firebaseio.com';
const appConfig = {projectId:project,databaseURL:dbHost,apiKey:'emulated-key',authDomain:project+'.firebaseapp.com'};
const types = {'.css':'text/css','.js':'text/javascript','.html':'text/html','.png':'image/png'};
const root = path.resolve('public');
const settings = require('../firebase.json');
const csp = settings.hosting.headers[0].headers.find(header=>header.key==='Content-Security-Policy').value;

async function resetData() {
  await fetch(firestore+'/emulator/v1/projects/'+demo+'/databases/(default)/documents',{method:'DELETE'});
  await fetch(database+'/.json?ns='+demo,{method:'DELETE',headers:{Authorization:'Bearer owner'}});
}

async function bind(page,requests,delay = 0,fault = null) {
  await page.route('https://www.gstatic.com/firebasejs/**',route=>{
    const authModule = `
      const user={email:${JSON.stringify(owner)},getIdToken:async()=>${JSON.stringify(token)},getIdTokenResult:async()=>({
        token:${JSON.stringify(token)},claims:{email_verified:true},signInProvider:'google.com'})};
      const auth={currentUser:null};
      let observer;
      export const getAuth=()=>auth;
      export class GoogleAuthProvider {}
      export function onAuthStateChanged(_,fn){observer=fn;fn(auth.currentUser);}
      export async function signInWithPopup(){auth.currentUser=user;await observer(user);}
      export async function signOut(){auth.currentUser=null;await observer(null);}
    `;
    return route.fulfill({contentType:'application/javascript',body:route.request().url().endsWith('firebase-auth.js') ? authModule : 'export const initializeApp = x=>x;'});
  });
  const remote = async route => {
    const req = route.request();
    const url = new URL(req.url());
    const fs = url.hostname==='firestore.googleapis.com';
    const target = fs ? firestore+url.pathname.replace(project,demo)+url.search : database+url.pathname+url.search;
    const endpoint = new URL(target);
    if (!fs) endpoint.searchParams.set('ns',demo);
    const headers = Object.fromEntries(Object.entries(await req.allHeaders()).filter(([key])=>
      ['authorization','content-type','if-match','x-firebase-etag'].includes(key)));
    requests.push({method:req.method(),path:url.pathname,bytes:req.postDataBuffer()?.length || 0});
    if (fault?.(req,url)) {
      return route.fulfill({
        status:503,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'{"error":"Test upload interruption"}'
      });
    }
    await new Promise(resolve=>setTimeout(resolve,delay));
    const body = fs && req.postData() ? req.postData().replaceAll('projects/'+project+'/','projects/'+demo+'/') : req.postDataBuffer();
    const response = await fetch(endpoint,{method:req.method(),headers,body:body || undefined});
    await route.fulfill({
      status:response.status,
      headers:{'Content-Type':'application/json',...(response.headers.has('etag') ? {'ETag':response.headers.get('etag')}:{}),
        'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'ETag'},
      body:Buffer.from(await response.arrayBuffer())
    });
  };
  await page.route('https://firestore.googleapis.com/**',remote);
  await page.route(dbHost+'/**',remote);
}

async function download(page,format) {
  const event = page.waitForEvent('download');
  await page.getByRole('button',{name:'Download '+format}).click();
  const download = await event;
  const bytes = await fs.readFile(await download.path());
  const dimensions = await page.evaluate(async ({bytes,type})=>{
    const data = new Blob([new Uint8Array(bytes)],{type});
    const image = await createImageBitmap(data);
    return [image.width,image.height];
  },{bytes:[...bytes],type:format==='PNG'?'image/png':'image/jpeg'});
  assert.deepEqual(dimensions,[1080,1080]);
}

async function main() {
  await resetData();
  const server = http.createServer(async (req,res) => {
    const url = new URL(req.url,'http://localhost');
    if (url.pathname==='/firebase-config.json') {
      res.writeHead(200,{'Content-Type':'application/json'});
      return res.end(JSON.stringify(appConfig));
    }
    const name = url.pathname==='/' ? '/index.html' : url.pathname==='/admin' ? '/admin.html' : url.pathname;
    try {
      const file = path.join(root,name);
      const body = await fs.readFile(file);
      res.writeHead(200,{'Content-Type':types[path.extname(file)] || 'text/plain','Content-Security-Policy':csp});
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
    const base='http://127.0.0.1:'+server.address().port;
    const admin=await browser.newPage();
    const uploadRequests = [];
    let breakUploadAt = 0;
    let bulkAttempt = 0;
    await bind(admin,uploadRequests,0,(req,url)=>{
      if (req.method()!=='PUT' || !url.pathname.startsWith('/art/archive-test/')) return false;
      return ++bulkAttempt === breakUploadAt;
    });
    await admin.goto(base+'/admin');
    await admin.getByRole('button',{name:'Continue with Google'}).click();
    await admin.getByRole('button',{name:'Load KUET starter artwork'}).click();
    await admin.getByText('KUET starter ready.',{exact:false}).waitFor();
    await admin.getByRole('button',{name:'Preview frame'}).click();
    await admin.getByAltText('Frame preview').waitFor();
    await admin.getByRole('button',{name:'Save draft'}).click();
    await admin.getByText('Draft saved.',{exact:true}).waitFor();
    const desktop=await browser.newPage({viewport:{width:1300,height:950}});
    const publicRequests=[];
    await bind(desktop,publicRequests);
    await desktop.goto(base);
    await desktop.getByText('This campaign is unavailable or has not been published.').waitFor();
    const largeSquare = await admin.evaluate(async ()=>{
      const image = new Image();
      image.src = '/art/kuet-starter.png';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2048;
      canvas.getContext('2d').drawImage(image,0,0,2048,2048);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const singleChooser = admin.waitForEvent('filechooser');
    await admin.getByRole('button',{name:'Add frames',exact:true}).click();
    await (await singleChooser).setFiles({name:'large.png',mimeType:'image/png',buffer:Buffer.from(largeSquare,'base64')});
    await admin.getByText('Frame ready.',{exact:false}).waitFor();
    await admin.getByLabel('Frame name').nth(1).fill('Alternative');
    await admin.getByRole('button',{name:'Move up'}).nth(1).click();
    await admin.getByLabel('Default frame').selectOption({label:'Alternative'});
    await admin.getByRole('button',{name:'Publish',exact:true}).click();
    await admin.getByText('Campaign published.',{exact:true}).waitFor({timeout:12000}).catch(async error=>{ throw Error(await admin.locator('#status').innerText(),{cause:error}); });

    const start=Date.now();
    const mobile=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const traffic=[];
    await bind(mobile,traffic,160);
    const client=await mobile.context().newCDPSession(mobile);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:175000,uploadThroughput:75000});
    await mobile.goto(base,{waitUntil:'domcontentloaded'});
    await mobile.getByRole('heading',{name:'KUET 4th Convocation 2027'}).waitFor();
    const shellMs=Date.now()-start;
    await mobile.waitForFunction(()=>document.querySelector('#frameFeedback').textContent==='');
    await mobile.waitForFunction(()=>document.querySelectorAll('#frames img:not([hidden])').length===2);
    assert.equal(await mobile.locator('#frames').evaluate(el=>getComputedStyle(el).flexDirection),'row');
    assert.equal(await mobile.getByRole('button',{name:'Alternative'}).getAttribute('aria-pressed'),'true');
    assert.equal(traffic.filter(x=>x.path.endsWith('/full.json')).length,1);
    assert.equal(traffic.filter(x=>x.path.endsWith('/thumb.json')).length,2);
    const artworkMs=Date.now()-start;

    await mobile.locator('#photo').setInputFiles('public/art/kuet-starter.png');
    await mobile.getByRole('button',{name:'Download PNG'}).waitFor();
    await mobile.waitForFunction(()=>!document.querySelector('#png').disabled);
    await mobile.locator('canvas').scrollIntoViewIfNeeded();
    const stage=await mobile.locator('canvas').boundingBox();
    const touch=(x,y,id)=>({x:stage.x+x,y:stage.y+y,id});
    const move=(type,touchPoints)=>client.send('Input.dispatchTouchEvent',{type,touchPoints});
    await move('touchStart',[touch(95,110,1)]);
    await move('touchMove',[touch(110,125,1)]);
    await move('touchStart',[touch(110,125,1),touch(165,125,2)]);
    await move('touchMove',[touch(80,125,1),touch(190,125,2)]);
    await move('touchEnd',[]);
    assert.ok(Number(await mobile.locator('#zoom').inputValue())>1.3);
    assert.equal(await mobile.getByRole('slider',{name:'Rotation'}).isVisible(),false);
    assert.equal(await mobile.getByRole('button',{name:'Reset position'}).isVisible(),false);
    await mobile.getByRole('button',{name:'Adjust photo'}).tap();
    await mobile.getByRole('slider',{name:'Rotation'}).waitFor();
    await mobile.locator('#rotation').focus();
    await mobile.keyboard.press('ArrowRight');
    const zoom=await mobile.locator('#zoom').inputValue();
    const rotation=await mobile.locator('#rotation').inputValue();
    await mobile.getByRole('button',{name:'Emerald & Gold'}).click();
    await mobile.waitForFunction(()=>!document.querySelector('#png').disabled);
    assert.equal(await mobile.locator('#zoom').inputValue(),zoom);
    assert.equal(await mobile.locator('#rotation').inputValue(),rotation);
    await mobile.getByRole('button',{name:'Hide adjustments'}).tap();
    assert.equal(await mobile.getByRole('slider',{name:'Rotation'}).isVisible(),false);
    await mobile.setViewportSize({width:320,height:568});
    const preview = await mobile.locator('#canvas').boundingBox();
    const downloadDock = await mobile.getByRole('group',{name:'Download photo'}).boundingBox();
    assert.ok(preview.width <= 320 && preview.height <= 300);
    assert.equal(Math.round(downloadDock.y+downloadDock.height),568);
    const requestCount=traffic.length;
    await download(mobile,'PNG');
    await download(mobile,'JPG');
    assert.equal(await mobile.locator('#zoom').inputValue(),zoom);
    assert.equal(await mobile.locator('#rotation').inputValue(),rotation);
    assert.equal(traffic.length,requestCount);
    assert.ok(traffic.every(x=>x.method==='GET' && x.bytes===0));

    const fullRequests=traffic.filter(x=>x.path.endsWith('/full.json')).length;
    await mobile.reload();
    await mobile.waitForFunction(()=>document.querySelectorAll('#frames img:not([hidden])').length===2);
    await mobile.waitForFunction(()=>document.querySelector('#frameFeedback').textContent==='');
    assert.equal(traffic.filter(x=>x.path.endsWith('/full.json')).length,fullRequests);
    await desktop.reload();
    await desktop.getByRole('button',{name:'Alternative'}).waitFor();
    assert.equal(await desktop.locator('#frames').evaluate(el=>getComputedStyle(el).flexDirection),'column');

    await admin.getByLabel('Replace PNG').first().setInputFiles('public/art/kuet-starter.png');
    await admin.getByText('Replacement ready.',{exact:false}).waitFor();
    admin.once('dialog',dialog=>dialog.accept());
    await admin.getByRole('button',{name:'Delete frame'}).last().click();
    await admin.getByRole('button',{name:'Publish',exact:true}).click();
    await admin.getByText('Campaign published.',{exact:true}).waitFor({timeout:12000}).catch(async error=>{ throw Error(await admin.locator('#status').innerText(),{cause:error}); });
    await desktop.reload();
    await desktop.getByRole('button',{name:'Alternative'}).waitFor();
    assert.equal(await desktop.getByRole('button',{name:'Emerald & Gold'}).count(),0);
    admin.once('dialog',dialog=>dialog.accept());
    await admin.getByRole('button',{name:'Disable',exact:true}).click();
    await admin.getByText('Campaign disabled.',{exact:true}).waitFor();
    await mobile.reload();
    await mobile.getByText('This campaign is unavailable or has not been published.').waitFor();
    const legacy = {
      slug:'archive-test',title:'Archived campaign',description:'Imported',defaultId:'original',
      frames:[{id:'original',name:'Legacy artwork',enabled:true,count:8,
        image:'data:image/png;base64,'+await fs.readFile('public/art/kuet-starter.png','base64')}]
    };
    await admin.getByLabel('Campaign export (.json)').locator('xpath=ancestor::details').locator('summary').click();
    await admin.getByLabel('Campaign export (.json)').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
    await admin.getByText('Legacy campaign ready.',{exact:false}).waitFor();
    assert.equal(await admin.getByLabel('Link slug').inputValue(),'archive-test');
    await admin.getByRole('button',{name:'Publish',exact:true}).click();
    await admin.getByText('Campaign published.',{exact:true}).waitFor();
    await desktop.goto(base+'/?campaign=archive-test');
    await desktop.getByRole('button',{name:'Legacy artwork'}).waitFor();
    await desktop.getByRole('button',{name:'Browse campaigns'}).click();
    await desktop.getByRole('combobox',{name:'Campaigns'}).waitFor();
    assert.equal(await desktop.getByRole('combobox',{name:'Campaigns'}).locator('option').count(),2);
    const bulk = await admin.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 60;
      const brush = canvas.getContext('2d');
      return Array.from({length:50},(_, index)=>{
        brush.clearRect(0,0,60,60);
        brush.fillStyle = 'hsl('+(index*7)+' 95% 52%)';
        brush.fillRect(0,0,60,4+index%3);
        return canvas.toDataURL('image/png').split(',')[1];
      });
    });
    assert.equal(new Set(bulk).size,50);
    const files = bulk.map((bytes,index)=>({
      name:'Frame '+String(index+1).padStart(2,'0')+'.png',mimeType:'image/png',buffer:Buffer.from(bytes,'base64')
    }));
    breakUploadAt = bulkAttempt+3;
    const bulkChooser = admin.waitForEvent('filechooser');
    await admin.getByRole('button',{name:'Add frames',exact:true}).focus();
    await admin.keyboard.press('Enter');
    const picker = await bulkChooser;
    assert.ok(picker.isMultiple());
    await picker.setFiles(files);
    await admin.getByText('50 frames ready.',{exact:false}).waitFor();
    await admin.getByRole('button',{name:'Publish',exact:true}).click();
    await admin.getByText('2 frame upload(s) saved to the draft. Upload failed for “Frame 03”.',{exact:false}).waitFor();
    const draftResponse = await fetch(firestore+'/v1/projects/'+demo+'/databases/(default)/documents/drafts/archive-test',{
      headers:{Authorization:'Bearer '+token}
    });
    const draftRecord = await draftResponse.json();
    assert.equal(draftRecord.fields.frames.arrayValue.values.length,3);
    await desktop.reload();
    await desktop.getByRole('button',{name:'Legacy artwork'}).waitFor();
    assert.equal(await desktop.locator('#frames button').count(),1);

    await admin.getByRole('button',{name:'Save draft'}).click();
    await admin.getByText('Draft saved.',{exact:true}).waitFor();
    assert.equal(bulkAttempt,52); // One previous frame, 50 distinct uploads, one failed attempt.
    await admin.getByRole('button',{name:'Move up'}).nth(1).click();
    await admin.getByLabel('Default frame').selectOption({label:'Frame 01'});
    await admin.getByLabel('Enabled',{exact:true}).nth(1).uncheck();
    await admin.getByRole('button',{name:'Publish',exact:true}).click();
    await admin.getByText('Campaign published.',{exact:true}).waitFor();
    const galleryTraffic = [];
    const gallery = await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
    let failFullOnce = false;
    await bind(gallery,galleryTraffic,0,(_req,url)=>{
      if (!failFullOnce || !url.pathname.endsWith('/full.json')) return false;
      failFullOnce = false;
      return true;
    });
    await gallery.goto(base+'/?campaign=archive-test');
    await gallery.getByRole('button',{name:'Frame 01',exact:true}).waitFor();
    await gallery.locator('#frames button img:not([hidden])').first().waitFor();
    assert.equal(await gallery.locator('#frames button').count(),50);
    assert.equal(await gallery.getByRole('button',{name:'Legacy artwork'}).count(),0);
    assert.equal(await gallery.getByRole('button',{name:'Frame 01',exact:true}).getAttribute('aria-pressed'),'true');
    assert.ok(galleryTraffic.filter(req=>req.path.endsWith('/thumb.json')).length<12);
    assert.equal(galleryTraffic.filter(req=>req.path.endsWith('/full.json')).length,1);
    const last = gallery.getByRole('button',{name:'Frame 50',exact:true});
    assert.equal(await last.locator('img').getAttribute('src'),null);
    await last.scrollIntoViewIfNeeded();
    await last.locator('img:not([hidden])').waitFor();
    assert.equal(galleryTraffic.filter(req=>req.path.endsWith('/full.json')).length,1);
    const fullPath = galleryTraffic.find(req=>req.path.endsWith('/full.json')).path.replace(/\.json$/,'');
    const cacheLocation = '/.frame-cache/'+project+fullPath;
    await gallery.evaluate(async key => {
      const cache = await caches.open('studio-artwork-v1');
      await cache.put(key,new Response('corrupted artwork',{headers:{'Content-Type':'image/png'}}));
    },cacheLocation);
    failFullOnce = true;
    await gallery.reload();
    const selected = gallery.getByRole('button',{name:'Frame 01',exact:true});
    await selected.waitFor();
    await gallery.locator('#photo').setInputFiles('public/art/kuet-starter.png');
    await gallery.waitForFunction(()=>!document.querySelector('#png').disabled);
    assert.equal(galleryTraffic.filter(req=>req.path.endsWith('/full.json')).length,3);
    await download(gallery,'PNG');
    await download(gallery,'JPG');
    console.log('Corrupt cached frame repaired, transient full-artwork failure retried, PNG/JPG exports passed.');
    console.log('50 distinct uploads passed with interrupted-save recovery; all 50 enabled gallery entries are available and thumbnails load on scroll.');
    await admin.getByRole('button',{name:'Sign out'}).click();
    await admin.getByRole('button',{name:'Continue with Google'}).waitFor();
    console.log(JSON.stringify({shellMs,artworkMs,fullRequests,visitorWriteRequests:0}));
    console.log('Browser flows passed against both Firebase emulators with a simulated Google identity.');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
