import {asset, defaultCampaign, listLive, readLive, validSlug} from './firebase-data.js';

const $ = id => document.getElementById(id);
function notice(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error',error);
}
function fail(error) { notice(error.message || String(error),true); }
function node(tag,text,attrs = {}) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  Object.entries(attrs).forEach(([name,value]) => el.setAttribute(name,value));
  return el;
}
function button(text,action,cls = '') {
  const el = node('button',text,{type:'button',class:cls});
  el.onclick = action;
  return el;
}
function decode(src) {
  return new Promise((resolve,reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(Error('This image could not be opened.'));
    image.src = src;
  });
}
async function copy(link) {
  try { await navigator.clipboard.writeText(link); notice('Campaign link copied.'); }
  catch (error) { window.prompt('Copy this campaign link',link); }
}
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const size = canvas.width;
let campaign, photo, overlay, frameRequest = 0;
let transform = {x:0,y:0,zoom:1,rotation:0};
function paint(target = ctx, jpeg = false) {
  target.clearRect(0,0,size,size);
  if (jpeg) { target.fillStyle = '#fff'; target.fillRect(0,0,size,size); }
  if (photo) {
    const scale = Math.max(size/photo.naturalWidth,size/photo.naturalHeight)*transform.zoom;
    const w = photo.naturalWidth*scale;
    const h = photo.naturalHeight*scale;
    target.save();
    target.translate(size/2+transform.x,size/2+transform.y);
    target.rotate(transform.rotation*Math.PI/180);
    target.drawImage(photo,-w/2,-h/2,w,h);
    target.restore();
  }
  if (overlay) target.drawImage(overlay,0,0,size,size);
}
function update() {
  $('hint').hidden = !!photo || !!overlay;
  $('zoom').value = transform.zoom;
  $('rotation').value = transform.rotation;
  $('png').disabled = $('jpg').disabled = !(photo && overlay);
  paint();
}
function reset() { transform = {x:0,y:0,zoom:1,rotation:0}; update(); }
let photoRequest = 0;
$('choosePhoto').onclick = () => { $('photo').value = ''; $('photo').click(); };
$('photo').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  const request = ++photoRequest;
  const url = URL.createObjectURL(file);
  try {
    const image = await decode(url);
    if (request !== photoRequest) return;
    photo = image;
    reset();
  } catch (error) { if (request === photoRequest) fail(error); }
  finally { URL.revokeObjectURL(url); }
};
$('zoom').oninput = event => { transform.zoom = Number(event.target.value); update(); };
$('rotation').oninput = event => { transform.rotation = Number(event.target.value); update(); };
$('reset').onclick = reset;
$('toggleAdjustments').onclick = event => {
  const control = event.currentTarget;
  const expanded = control.getAttribute('aria-expanded') !== 'true';
  control.setAttribute('aria-expanded',String(expanded));
  control.textContent = expanded ? 'Hide adjustments' : 'Adjust photo';
  $('photoAdjustments').dataset.expanded = String(expanded);
};
const pointers = new Map();
function point(event) {
  const box = canvas.getBoundingClientRect();
  return {x:(event.clientX-box.left)*size/box.width-size/2,y:(event.clientY-box.top)*size/box.height-size/2};
}
function gesture() {
  const [a,b] = pointers.values();
  return b ? {x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y)} : {...a,d:0};
}
canvas.onpointerdown = event => {
  if (!photo || pointers.size >= 2 || event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId,point(event));
};
canvas.onpointermove = event => {
  if (!pointers.has(event.pointerId)) return;
  const before = gesture();
  pointers.set(event.pointerId,point(event));
  const after = gesture();
  const next = before.d && after.d ? Math.max(.25,Math.min(5,transform.zoom*after.d/before.d)) : transform.zoom;
  const ratio = next/transform.zoom;
  transform.x = after.x+(transform.x-before.x)*ratio;
  transform.y = after.y+(transform.y-before.y)*ratio;
  transform.zoom = next;
  update();
};
canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = event => pointers.delete(event.pointerId);
async function download(format) {
  if (!photo || !overlay) return;
  const campaignSlug = campaign.slug;
  const image = document.createElement('canvas');
  image.width = image.height = size;
  paint(image.getContext('2d'),format === 'jpg');
  const type = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise(resolve => image.toBlob(resolve,type,.95));
  if (!blob) throw Error('The export could not be created.');
  const url = URL.createObjectURL(blob);
  const anchor = node('a',null,{href:url,download:campaignSlug+'.'+format});
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url),60000);
}

$('png').onclick = () => download('png').catch(fail);
$('jpg').onclick = () => download('jpg').catch(fail);


let galleryObserver;
let selectedRequest;
const fullImages = new Map();
const thumbnailQueue = new Map();
let activeThumbs = 0;

async function decodeArtwork(blob,expectedSize) {
  const url = URL.createObjectURL(blob);
  try {
    const image = await decode(url);
    if (image.naturalWidth !== expectedSize || image.naturalHeight !== expectedSize) {
      throw Error('Frame artwork has unexpected dimensions.');
    }
    return image;
  } finally { URL.revokeObjectURL(url); }
}

let loadingFull;
function sharedArtwork(current,item) {
  const key = current.slug+'/'+item.id+'/'+item.version;
  if (loadingFull && loadingFull.key !== key) {
    fullImages.delete(loadingFull.key);
    loadingFull.controller.abort();
  }
  if (!fullImages.has(key)) {
    const controller = new AbortController();
    const task = {key,controller};
    loadingFull = task;
    const pending = asset(current.slug,item,'full',undefined,controller.signal,blob=>decodeArtwork(blob,size)).catch(error => {
      if (fullImages.get(key)===pending) fullImages.delete(key);
      throw error;
    }).finally(()=>{ if (loadingFull===task) loadingFull = null; });
    fullImages.set(key,pending);
    if (fullImages.size > 4) fullImages.delete(fullImages.keys().next().value);
  }
  return fullImages.get(key);
}

async function selectFrame(current,item) {
  if (campaign !== current) return;
  const request = ++frameRequest;
  overlay = null;
  update();
  for (const card of $('frames').children) card.setAttribute('aria-pressed',String(card.dataset.id === item.id));
  $('frameFeedback').textContent = 'Loading frame…';
  try {
    const loaded = await sharedArtwork(current,item);
    if (request !== frameRequest) return;
    overlay = loaded;
    $('frameFeedback').textContent = '';
    update();
  } catch (error) {
    if (request === frameRequest) $('frameFeedback').textContent = error.message || 'Frame unavailable. Select it again to retry.';
  }
}

async function loadThumb(card,current,item) {
  if (!card.isConnected || campaign !== current) return;
  const indicator = card.querySelector('small');
  const img = card.querySelector('img');
  try {
    const thumbnail = await asset(current.slug,item,'thumb',undefined,undefined,blob=>decodeArtwork(blob,240));
    if (!card.isConnected) return;
    // A revoked object URL cannot be loaded into another image. Reuse the decoded element.
    thumbnail.alt = '';
    img.replaceWith(thumbnail);
    indicator.hidden = true;
    card.dataset.thumb = 'loaded';
  } catch {
    indicator.textContent = 'Preview unavailable';
    card.dataset.thumb = 'failed';
  }
}

function drainThumbs() {
  while (thumbnailQueue.size && activeThumbs < 2) {
    const [card,{current,item}] = thumbnailQueue.entries().next().value;
    thumbnailQueue.delete(card);
    if (!card.isConnected || campaign !== current) continue;
    card.dataset.thumb = 'loading';
    activeThumbs++;
    loadThumb(card,current,item).finally(() => { activeThumbs--; drainThumbs(); });
  }
}

function queueThumb(card,current,item) {
  card.dataset.thumb = 'queued';
  thumbnailQueue.set(card,{current,item});
  drainThumbs();
}

function makeGallery(current) {
  galleryObserver?.disconnect();
  thumbnailQueue.clear();
  const framesById = new Map(current.frames.map(item=>[item.id,item]));
  const observer = new IntersectionObserver(entries => {
    if (campaign !== current) return;
    for (const {isIntersecting,target} of entries) {
      if (!isIntersecting) {
        if (thumbnailQueue.delete(target)) delete target.dataset.thumb;
      } else if (!target.dataset.thumb) {
        queueThumb(target,current,framesById.get(target.dataset.id));
      }
    }
  },{root:$('frames'),rootMargin:'100px'});
  galleryObserver = observer;
  const cards = current.frames.map(item => {
    const card = button(null,() => {
      selectFrame(current,item);
      if (card.dataset.thumb === 'failed') queueThumb(card,current,item);
    });
    const thumb = node('span',null,{class:'frame-thumb','aria-hidden':'true'});
    thumb.append(node('img',null,{alt:'',hidden:''}),node('small','Loading…'));
    card.append(thumb,node('span',item.name));
    card.dataset.id = item.id;
    card.setAttribute('aria-pressed','false');
    return card;
  });
  const fragment = document.createDocumentFragment();
  for (const card of cards) fragment.append(card);
  $('frames').replaceChildren(fragment);
  for (const card of cards) observer.observe(card);
}

function shareLink(slug) {
  const url = new URL('/',location.origin);
  url.searchParams.set('campaign',slug);
  return url.href;
}

async function showCampaign(slug) {
  const request = Symbol();
  selectedRequest = request;
  $('share').hidden = true;
  notice('Loading campaign…');
  try {
    const current = await readLive(slug);
    if (selectedRequest !== request) return;
    if (!current) throw Error('This campaign is unavailable or has not been published.');
    campaign = current;
    overlay = null;
    $('title').textContent = current.title;
    $('description').textContent = current.description;
    $('share').hidden = false;
    $('share').onclick = () => copy(shareLink(slug));
    $('editor').hidden = false;
    notice('');
    const first = current.frames.find(item => item.id === current.defaultId) || current.frames[0];
    makeGallery(current);
    if (first) selectFrame(current,first);
    else { update(); $('frameFeedback').textContent = 'No frames are published.'; }
  } catch (error) {
    if (selectedRequest !== request) return;
    campaign = overlay = null;
    ++frameRequest;
    loadingFull?.controller.abort();
    fullImages.clear();
    $('title').textContent = 'Photo Frame Studio';
    $('description').textContent = '';
    $('editor').hidden = true;
    notice(error.message,true);
  }
}

$('browse').onclick = async () => {
  $('browse').disabled = true;
  try {
    const campaigns = await listLive();
    if (!campaigns.length) throw Error('No campaigns are published.');
    const picker = $('campaigns');
    picker.replaceChildren(node('option','Choose a campaign',{value:''}),...campaigns.map(item =>
      node('option',item.title,{value:item.slug})));
    picker.value = campaign?.slug || '';
    picker.hidden = false;
    $('browse').hidden = true;
    picker.focus();
  } catch (error) { notice(error.message,true); }
  finally { $('browse').disabled = false; }
};
$('campaigns').onchange = event => {
  const slug = event.target.value;
  if (!validSlug(slug)) return;
  history.replaceState(null,'',shareLink(slug));
  showCampaign(slug);
};

const slug = new URL(location.href).searchParams.get('campaign') || defaultCampaign;
if (validSlug(slug)) showCampaign(slug);
else {
  $('editor').hidden = true;
  notice('This campaign link is invalid.',true);
}
