import {
  asset, config, defaultCampaign, listDrafts, listLive, ownerEmail, publishCampaign,
  readCampaign, removeArt, storeArt, validSlug, withCampaignLock, writeCampaign
} from './firebase-data.js';

const $ = id => document.getElementById(id);
const SIZE = 1080;
const MAX_INPUT = 8 * 1024 * 1024;
let auth;
let sessionUser;
let busy = false;
let draft;
let baseline;
let campaigns = [];
let published = new Set();
let staged = new Map();
let dirty = false;

function notice(text,error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error',error);
}

function el(tag,text,attrs = {}) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  for (const [key,value] of Object.entries(attrs)) element.setAttribute(key,value);
  return element;
}

function button(text,handler,cls = '') {
  const b = el('button',text,{type:'button',class:cls});
  b.onclick = handler;
  return b;
}

function labeled(name,field) {
  const label = el('label',name);
  label.append(field);
  return label;
}

function action(work) {
  return async () => {
    if (busy || !sessionUser) return;
    const user = sessionUser;
    busy = true;
    $('dashboard').inert = true;
    $('signOut').disabled = true;
    try { await work(await user.getIdToken()); }
    catch (error) { notice(error.message,true); }
    finally {
      busy = false;
      $('dashboard').inert = false;
      $('signOut').disabled = false;
    }
  };
}

function openDraft(record = null) {
  baseline = record;
  draft = record ? structuredClone(record) : {slug:'',title:'',description:'',frames:[],defaultId:''};
  staged = new Map();
  dirty = false;
  render();
}

function markDirty() { dirty = true; }

function canLeave() {
  return !dirty || confirm('Discard unsaved campaign changes?');
}

function chooseDraft(slug) {
  if (!canLeave()) { $('campaigns').value = baseline?.slug || ''; return; }
  openDraft(campaigns.find(item=>item.slug===slug));
}

function renderCampaignList() {
  $('campaigns').replaceChildren(el('option','Select a campaign',{value:''}),...campaigns.map(item =>
    el('option',item.title+(published.has(item.slug) ? ' • Live' : ' • Draft'),{value:item.slug})));
  $('campaigns').value = baseline?.slug || '';
  $('starter').hidden = campaigns.some(item=>item.slug===defaultCampaign);
}

function share() {
  const url = new URL('/',location.origin);
  url.searchParams.set('campaign',draft.slug);
  return navigator.clipboard.writeText(url.href).then(()=>notice('Campaign link copied.'))
    .catch(()=>prompt('Copy this campaign link',url.href));
}

function textField(label,value,attrs,oninput,tag = 'input') {
  const field = el(tag,null,attrs);
  field.value = value;
  field.oninput = () => { oninput(field.value); markDirty(); };
  return labeled(label,field);
}

function galleryRow(frame,index) {
  const row = el('div',null,{class:'frame-admin stack'});
  const preview = el('img',null,{class:'frame-preview',alt:'Frame preview',hidden:''});
  const name = textField('Frame name',frame.name,{maxlength:100},value=>frame.name=value);
  const enable = el('input',null,{type:'checkbox'});
  enable.checked = frame.enabled;
  enable.onchange = () => { frame.enabled = enable.checked; markDirty(); };
  const enabled = labeled('Enabled',enable);
  enabled.className = 'check';
  const replace = el('input',null,{type:'file',accept:'image/png'});
  replace.onchange = action(async () => {
    const file = replace.files[0];
    if (!file) return;
    notice('Optimizing frame…');
    const artwork = await processFile(file);
    staged.delete(frame.version);
    frame.version = crypto.randomUUID();
    staged.set(frame.version,artwork);
    markDirty();
    render();
    notice('Replacement ready. Save the draft to keep it.');
  });
  const actions = el('div',null,{class:'admin-actions'});
  const up = button('Move up',() => moveFrame(index,-1));
  const down = button('Move down',() => moveFrame(index,1));
  up.disabled = index===0;
  down.disabled = index===draft.frames.length-1;
  actions.append(up,down,button('Preview frame',action(async token => {
    notice('Loading frame preview…');
    const artwork = staged.get(frame.version);
    if (artwork) preview.src = artwork.full;
    else {
      const url = URL.createObjectURL(await asset(draft.slug,frame,'full',token));
      try { preview.src = url; await preview.decode(); }
      finally { URL.revokeObjectURL(url); }
    }
    preview.hidden = false;
    notice('');
  })),button('Delete frame',() => {
    if (!confirm('Remove this frame from the draft? Publish to apply the change to the live campaign.')) return;
    draft.frames.splice(index,1);
    staged.delete(frame.version);
    if (draft.defaultId===frame.id) draft.defaultId = '';
    markDirty();
    render();
  },'danger'));
  const thumbnail = staged.get(frame.version);
  if (thumbnail) { preview.src = thumbnail.thumb; preview.hidden = false; }
  row.append(name,enabled,labeled('Replace PNG',replace),actions,preview);
  return row;
}

function moveFrame(index,delta) {
  const next = index+delta;
  [draft.frames[index],draft.frames[next]] = [draft.frames[next],draft.frames[index]];
  markDirty();
  render();
}

function render() {
  renderCampaignList();
  const panel = el('section',null,{class:'panel stack'});
  panel.append(el('h2',baseline ? baseline.title : 'New campaign'));
  const title = textField('Campaign title',draft.title,{maxlength:100},value=>{
    draft.title = value;
    if (!baseline && !draft.customSlug) {
      draft.slug = value.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,80).replace(/^-|-$/g,'');
      slug.querySelector('input').value = draft.slug;
    }
  });
  const slug = textField('Link slug',draft.slug,{maxlength:80},value=>{ draft.slug=value; draft.customSlug=true; });
  slug.querySelector('input').readOnly = !!baseline;
  const description = textField('Description',draft.description,{maxlength:2000,rows:3},value=>draft.description=value,'textarea');
  const actions = el('div',null,{class:'admin-actions'});
  actions.append(button('Save draft',action(async token => {
    await saveDraft(token);
    notice('Draft saved.');
  })),button('Publish',action(token=>goLive(token)), 'primary'));
  if (baseline && published.has(baseline.slug)) {
    actions.append(button('Disable',action(token=>goLive(token,true)),'danger'),button('Copy campaign link',share));
  }
  const choices = el('select');
  choices.append(el('option','First enabled frame',{value:''}),...draft.frames.map(frame=>el('option',frame.name || 'Unnamed frame',{value:frame.id})));
  choices.value = draft.defaultId;
  choices.onchange = () => { draft.defaultId = choices.value; markDirty(); };
  panel.append(title,slug,description,labeled('Default frame',choices),actions);
  const framePanel = el('section',null,{class:'panel stack'});
  const upload = el('input',null,{type:'file',accept:'image/png',multiple:'',hidden:''});
  const frameHeader = el('div',null,{class:'row spread'});
  frameHeader.append(el('h2','Frames ('+draft.frames.length+')'),button('Add frames',() => upload.click(),'primary'));
  framePanel.append(frameHeader,el('p','Select one or more transparent square PNGs, up to 8 MB each. Full artwork renders at 1080 × 1080.'));
  upload.onchange = action(async () => {
    const files = Array.from(upload.files);
    const errors = [];
    let added = 0;
    for (const [index,file] of files.entries()) {
      notice('Optimizing frame '+(index+1)+' of '+files.length+'…');
      try {
        addFrame(file.name.replace(/\.png$/i,'').slice(0,100),await processFile(file));
        added++;
      } catch (error) {
        errors.push(file.name+': '+error.message);
      }
    }
    render();
    if (errors.length) {
      notice(added+' ready. '+errors.length+' skipped. '+errors.join(' '),true);
    } else if (added) {
      notice((added===1 ? 'Frame ready.' : added+' frames ready.')+' Save the draft to keep '+(added===1 ? 'it.' : 'them.'));
    }
  });
  framePanel.append(upload,...draft.frames.map(galleryRow));
  $('manage').replaceChildren(panel,framePanel);
}

function cleanupCandidates(old,keep) {
  const referenced = new Set(keep.flatMap(item => (item?.frames || []).map(frame=>frame.version)));
  return (old?.frames || []).filter(frame=>!referenced.has(frame.version));
}

async function removeRetired(slug,frames,token,renew) {
  let failures = 0;
  for (const frame of frames) {
    await renew();
    try { await removeArt(slug,frame.id,frame.version,token); }
    catch { failures++; }
  }
  if (failures) console.warn('Some unused artwork could not be removed:',failures);
}

function cleanDraft() {
  const title = draft.title.trim();
  const description = draft.description.trim();
  const frames = draft.frames.map(({id,version,name,enabled,legacyCount})=>({
    id,version,name:name.trim(),enabled,...(Number.isSafeInteger(legacyCount) ? {legacyCount} : {})
  }));
  if (!validSlug(draft.slug)) throw Error('Use a unique link slug with lowercase letters, numbers and hyphens.');
  if (!title || title.length>100 || description.length>2000 || frames.some(frame=>!frame.name || frame.name.length>100)) {
    throw Error('Check the campaign title, description and frame names.');
  }
  return {title,description,frames,defaultId:draft.defaultId};
}

async function saveWhileLocked(token,renew) {
  const data = cleanDraft();
  const slug = draft.slug;
  const latest = await readCampaign('drafts',slug,token);
  if ((latest?.updateTime || '') !== (baseline?.updateTime || '')) throw Error('This campaign changed in another tab. Refresh before editing again.');
  const pending = data.frames.filter(frame=>staged.has(frame.version));
  const uploaded = new Set();
  let failure;
  for (const [index,frame] of pending.entries()) {
    notice('Uploading frame '+(index+1)+' of '+pending.length+' ('+frame.name+')…');
    await renew();
    try {
      await storeArt(slug,frame.id,frame.version,staged.get(frame.version),token);
      uploaded.add(frame.version);
    } catch (error) {
      failure = Error('Upload failed for “'+frame.name+'”. '+error.message);
      break;
    }
  }
  if (failure && !uploaded.size) throw failure;
  const previous = baseline;
  if (failure) {
    // Checkpoint successful uploads. Keep the saved artwork for pending replacements.
    const previousFrames = new Map((previous?.frames || []).map(frame=>[frame.id,frame]));
    data.frames = data.frames.flatMap(frame => {
      if (!staged.has(frame.version) || uploaded.has(frame.version)) return [frame];
      const old = previousFrames.get(frame.id);
      return old ? [old] : [];
    });
    if (!data.frames.some(frame=>frame.id===data.defaultId)) data.defaultId = previous?.defaultId || '';
    if (!data.frames.some(frame=>frame.id===data.defaultId)) data.defaultId = '';
  }
  await renew();
  const saved = await writeCampaign('drafts',slug,data,token,previous?.updateTime || '');
  campaigns = [...campaigns.filter(item=>item.slug!==saved.slug),saved].sort((a,b)=>a.title.localeCompare(b.title));
  if (failure) {
    baseline = saved;
    for (const version of uploaded) staged.delete(version);
    render();
  } else {
    openDraft(saved);
  }
  if (previous) {
    const live = await readCampaign('live',slug,token);
    await removeRetired(slug,cleanupCandidates(previous,[live,saved]),token,renew);
  }
  if (failure) {
    throw Error(uploaded.size+' frame upload(s) saved to the draft. '+failure.message+' Save the draft again to retry the remaining frames.');
  }
  return saved;
}

async function saveDraft(token) {
  cleanDraft();
  notice('Saving draft…');
  return withCampaignLock(draft.slug,token,renew=>saveWhileLocked(token,renew));
}

async function goLive(token,disable = false) {
  if (!disable) cleanDraft();
  const slug = disable ? baseline.slug : draft.slug;
  if (disable && !confirm('Disable this campaign for public visitors?')) return;
  if (!disable && !draft.frames.some(frame=>frame.enabled)) throw Error('Enable at least one frame before publishing.');
  notice(disable ? 'Disabling campaign…' : 'Publishing campaign…');
  await withCampaignLock(slug,token,async renew => {
    const live = await readCampaign('live',slug,token);
    // Disabling does not publish or discard edits that are still in the editor.
    const record = disable ? baseline : (dirty || !baseline ? await saveWhileLocked(token,renew) : await readCampaign('drafts',slug,token));
    if (!record || (!disable && record.updateTime!==baseline.updateTime)) throw Error('The draft changed. Refresh before publishing.');
    await renew();
    await publishCampaign(record,token,disable);
    if (disable) published.delete(slug);
    else published.add(slug);
    const current = await readCampaign('drafts',slug,token);
    await removeRetired(slug,cleanupCandidates(live,[current,disable ? null : record]),token,renew);
    render();
  });
  notice(disable ? 'Campaign disabled.' : 'Campaign published.');
}

function renderPng(image,size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d',{willReadFrequently:size===SIZE});
  context.imageSmoothingQuality = 'high';
  context.drawImage(image,0,0,size,size);
  return {canvas,context};
}

async function processFile(file) {
  if (file.size>MAX_INPUT || file.type!=='image/png') throw Error('Choose a transparent PNG up to 8 MB.');
  const signature = new Uint8Array(await file.slice(0,8).arrayBuffer());
  if (signature.join(',')!=='137,80,78,71,13,10,26,10') throw Error('Choose a valid PNG file.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth!==image.naturalHeight) throw Error('Frame width and height must match.');
    const {canvas,context} = renderPng(image,SIZE);
    const rgba = context.getImageData(0,0,SIZE,SIZE).data;
    let transparent = false;
    for (let index=3;index<rgba.length;index+=4) {
      if (rgba[index]<255) { transparent=true; break; }
    }
    if (!transparent) throw Error('The frame needs a transparent area for the photo.');
    return {full:canvas.toDataURL('image/png'),thumb:renderPng(canvas,240).canvas.toDataURL('image/png')};
  } finally { URL.revokeObjectURL(url); }
}

function addFrame(name,artwork) {
  const frame = {id:crypto.randomUUID(),version:crypto.randomUUID(),name:name || 'Frame',enabled:true};
  draft.frames.push(frame);
  staged.set(frame.version,artwork);
  markDirty();
  return frame;
}

$('campaigns').onchange = () => chooseDraft($('campaigns').value);
$('newCampaign').onclick = () => chooseDraft('');
$('starter').onclick = action(async () => {
  if (!canLeave()) return;
  const response = await fetch('/art/kuet-starter.png');
  if (!response.ok) throw Error('Starter artwork could not be loaded.');
  const artwork = await processFile(await response.blob());
  openDraft();
  draft.slug = defaultCampaign;
  draft.title = 'KUET 4th Convocation 2027';
  draft.description = 'Celebrate your graduation with a commemorative photo frame.';
  draft.defaultId = addFrame('Emerald & Gold',artwork).id;
  render();
  notice('KUET starter ready. Preview it and click Publish when ready.');
});

$('importFile').onchange = action(async () => {
  const file = $('importFile').files[0];
  if (!file) return;
  try {
    if (!canLeave()) return;
    const record = JSON.parse(await file.text());
    if (!validSlug(record.slug) || typeof record.title!=='string' || !Array.isArray(record.frames)) throw Error('Invalid legacy campaign export.');
    if (campaigns.some(item=>item.slug===record.slug)) throw Error('A campaign already uses this link slug. Import preserves existing drafts.');
    const prepared = [];
    notice('Optimizing imported frames…');
    for (const frame of record.frames) {
      if (typeof frame.image!=='string' || !frame.image.startsWith('data:image/png;base64,')) throw Error('The export contains an invalid frame.');
      const binary = atob(frame.image.slice('data:image/png;base64,'.length));
      const bytes = Uint8Array.from(binary,letter=>letter.charCodeAt(0));
      prepared.push([frame,await processFile(new Blob([bytes],{type:'image/png'}))]);
    }
    openDraft();
    draft.slug = record.slug;
    draft.title = record.title;
    draft.description = typeof record.description==='string' ? record.description : '';
    for (const [original,artwork] of prepared) {
      const frame = addFrame(original.name,artwork);
      frame.enabled = original.enabled===true;
      frame.legacyCount = original.count;
      if (original.id===record.defaultId) draft.defaultId = frame.id;
    }
    markDirty();
    render();
    notice('Legacy campaign ready. Review the draft before publishing.');
  } finally { $('importFile').value = ''; }
});

async function init() {
  const options = await config();
  const [appSdk,authSdk] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js')
  ]);
  auth = authSdk.getAuth(appSdk.initializeApp(options));
  $('signIn').onclick = async () => {
    $('signIn').disabled = true;
    try { await authSdk.signInWithPopup(auth,new authSdk.GoogleAuthProvider()); }
    catch (error) { notice('Google sign-in failed. '+error.message,true); }
    finally { $('signIn').disabled = false; }
  };
  $('signOut').onclick = () => { if (canLeave()) authSdk.signOut(auth); };
  authSdk.onAuthStateChanged(auth,async user => {
    sessionUser = null;
    $('dashboard').hidden = true;
    $('signOut').hidden = !user;
    $('session').hidden = !!user;
    if (!user) { notice(''); return; }
    try {
      const result = await user.getIdTokenResult();
      if (user.email!==ownerEmail || result.claims.email_verified!==true || result.signInProvider!=='google.com') {
        notice('This Google account does not have Super Admin access.',true);
        return;
      }
      const [drafts,live] = await Promise.all([listDrafts(result.token),listLive(result.token)]);
      if (auth.currentUser!==user) return;
      campaigns = drafts;
      published = new Set(live.map(item=>item.slug));
      sessionUser = user;
      openDraft(campaigns.find(item=>item.slug===defaultCampaign) || campaigns[0]);
      $('dashboard').hidden = false;
      notice('');
    } catch (error) { notice(error.message,true); }
  });
}

init().catch(error=>notice(error.message,true));
