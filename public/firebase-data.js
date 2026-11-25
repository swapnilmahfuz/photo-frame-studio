export const projectId = 'kuetconvocationphotoframe27';
export const defaultCampaign = 'kuet-4th-convocation-2027';
export const ownerEmail = 'swapnilmahfuz20@gmail.com';
export const validSlug = slug => typeof slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 80;
const validId = id => typeof id === 'string' && /^[a-z0-9-]{1,80}$/i.test(id);
let configRequest;

export function config() {
  if (!configRequest) configRequest = loadConfig().catch(error => { configRequest = null; throw error; });
  return configRequest;
}

async function loadConfig() {
  // Firebase Hosting supplies this file. A generated override supports non-default database instances.
  for (const path of ['/firebase-config.json','/__/firebase/init.json']) {
    const response = await fetch(path, {cache:'no-cache',signal:AbortSignal.timeout(12000)});
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) continue;
    const value = await response.json();
    if (value.projectId === projectId && /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)?\.(?:firebaseio\.com|firebasedatabase\.app)\/?$/.test(value.databaseURL || '')) {
      return {...value,databaseURL:value.databaseURL.replace(/\/$/,'')};
    }
  }
  throw Error('Firebase configuration is unavailable. Check the Hosting deployment and Realtime Database URL.');
}

function unpack(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(unpack);
  if ('mapValue' in value) return unpackFields(value.mapValue.fields);
  return null;
}

function unpackFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key,value]) => [key,unpack(value)]));
}

function pack(value) {
  if (typeof value === 'string') return {stringValue:value};
  if (typeof value === 'boolean') return {booleanValue:value};
  if (Number.isSafeInteger(value)) return {integerValue:String(value)};
  if (Array.isArray(value)) return {arrayValue:{values:value.map(pack)}};
  if (value && typeof value === 'object') return {mapValue:{fields:packFields(value)}};
  throw Error('Unsupported campaign value.');
}

function packFields(data) {
  return Object.fromEntries(Object.entries(data).map(([key,value]) => [key,pack(value)]));
}

function docRecord(doc) {
  return {...unpackFields(doc.fields),slug:doc.name.split('/').at(-1),updateTime:doc.updateTime || ''};
}

async function firestore(path, {method = 'GET', token, data} = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (data) headers['Content-Type'] = 'application/json';
  const response = await fetch('https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents' + (path.startsWith(':') ? path : '/'+path),{
    method,headers,body:data ? JSON.stringify(data) : undefined,cache:'no-store',signal:AbortSignal.timeout(18000)
  });
  if (response.status === 404 && method === 'GET') return null;
  if ([400,409,412].includes(response.status)) {
    const failure = await response.json().catch(()=>null);
    if (['FAILED_PRECONDITION','ABORTED','ALREADY_EXISTS'].includes(failure?.error?.status)) {
      throw Error('This campaign may have changed in another tab. Refresh the dashboard before saving again.');
    }
  }
  if (!response.ok) throw Error('Campaign request failed ('+response.status+'). Check access and try again.');
  return response.json();
}

export async function readCampaign(collection,slug,token) {
  if (!validSlug(slug)) return null;
  const doc = await firestore(collection+'/'+slug,{token});
  return doc ? docRecord(doc) : null;
}

async function listCampaigns(collection,token,summary) {
  const result = [];
  let next;
  do {
    const query = new URLSearchParams({pageSize:'100'});
    if (summary) query.append('mask.fieldPaths','title');
    if (next) query.set('pageToken',next);
    const page = await firestore(collection+'?'+query,{token});
    if (!page) return result;
    result.push(...(page.documents || []).map(docRecord));
    next = page.nextPageToken;
  } while (next);
  return result.sort((a,b) => a.title.localeCompare(b.title));
}

export const readLive = slug => readCampaign('live',slug);
export const listLive = token => listCampaigns('live',token,true);
export const listDrafts = token => listCampaigns('drafts',token,false);

export async function writeCampaign(collection,slug,data,token,expected) {
  if (!validSlug(slug)) throw Error('Invalid campaign link.');
  const name = 'projects/'+projectId+'/databases/(default)/documents/'+collection+'/'+slug;
  const write = {update:{name,fields:packFields(data)}};
  if (expected === '') write.currentDocument = {exists:false};
  if (expected) write.currentDocument = {updateTime:expected};
  const result = await firestore(':commit',{method:'POST',token,data:{writes:[write]}});
  return {...data,slug,updateTime:result.writeResults[0].updateTime};
}

export async function removeLive(slug,token) {
  await firestore('live/'+slug,{method:'DELETE',token});
}

class ArtworkRequestError extends Error {
  constructor(message,retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

async function readArtworkJson(response,progress) {
  if (!response.body) return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const pieces = [];
  let bytes = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      progress();
      bytes += value.byteLength;
      if (bytes > 9*1024*1024) {
        await reader.cancel().catch(()=>{});
        throw Error('The artwork response exceeds the supported size.');
      }
      pieces.push(decoder.decode(value,{stream:true}));
    }
    pieces.push(decoder.decode());
    return JSON.parse(pieces.join(''));
  } finally { reader.releaseLock(); }
}

async function realtime(path,{
  method = 'GET',token,data,etag,requestTag = false,silent = false,signal,timeout = 20000,stream = false
} = {}) {
  const {databaseURL} = await config();
  const url = new URL(databaseURL+'/'+path+'.json');
  if (token) url.searchParams.set('auth',token);
  if (silent) url.searchParams.set('print','silent');
  const headers = {};
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  if (requestTag) headers['X-Firebase-ETag'] = 'true';
  if (etag) headers['If-Match'] = etag;
  const idle = new AbortController();
  const deadline = AbortSignal.timeout(stream ? 300000 : timeout);
  const requestSignal = AbortSignal.any([deadline,idle.signal,...(signal ? [signal] : [])]);
  let idleTimer;
  const progress = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idle.abort(),timeout);
  };
  if (stream) progress();
  try {
    const response = await fetch(url,{
      method,headers,body:data === undefined ? undefined : JSON.stringify(data),
      cache:'no-store',referrerPolicy:'no-referrer',signal:requestSignal
    });
    if (response.status === 412) throw Error('Another tab is publishing this campaign. Try again shortly.');
    if (!response.ok) {
      const status = response.status;
      throw new ArtworkRequestError('Artwork request failed ('+status+'). Check access and try again.',
        status === 408 || status === 429 || status >= 500);
    }
    const payload = response.status === 204 ? null : stream
      ? await readArtworkJson(response,progress) : await response.json();
    return {data:payload,tag:response.headers.get('etag')};
  } catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted || idle.signal.aborted) {
      throw new ArtworkRequestError('Artwork request timed out. Check your connection and try again.',true);
    }
    if (stream && (error instanceof TypeError || error instanceof SyntaxError)) {
      throw new ArtworkRequestError('The artwork download was interrupted. Try again.',true);
    }
    throw error;
  } finally { clearTimeout(idleTimer); }
}

function artPath(slug,frame,version,variant) {
  if (!validSlug(slug) || !validId(frame) || !validId(version)) throw Error('Invalid artwork reference.');
  return 'art/'+slug+'/'+frame+'/'+version+(variant ? '/'+variant : '');
}

export function storeArt(slug,frame,version,art,token) {
  pngPayload(art.full,1080);
  pngPayload(art.thumb,240);
  return realtime(artPath(slug,frame,version),{method:'PUT',token,data:art,silent:true,timeout:90000});
}

export function removeArt(slug,frame,version,token) {
  return realtime(artPath(slug,frame,version),{method:'DELETE',token,silent:true});
}

export async function withCampaignLock(slug,token,work) {
  if (!validSlug(slug)) throw Error('Invalid campaign link.');
  const path = 'locks/'+slug;
  const previous = await realtime(path,{token,requestTag:true});
  if (!previous.tag) throw Error('Could not obtain the campaign lock.');
  if (previous.data?.operation && previous.data.expires > Date.now()) {
    throw Error('This campaign is being saved in another tab. Try again shortly.');
  }
  const operation = crypto.randomUUID();
  let lease = await realtime(path,{
    method:'PUT',token,etag:previous.tag,requestTag:true,
    data:{operation,expires:Date.now()+120000}
  });
  if (!lease.tag) lease = await realtime(path,{token,requestTag:true});
  if (!lease.tag || lease.data?.operation !== operation) throw Error('Could not confirm the campaign lock.');
  async function renew() {
    lease = await realtime(path,{
      method:'PUT',token,etag:lease.tag,requestTag:true,
      data:{operation,expires:Date.now()+120000}
    });
    if (!lease.tag) lease = await realtime(path,{token,requestTag:true});
    if (!lease.tag || lease.data?.operation !== operation) throw Error('The campaign lock expired.');
  }
  try { return await work(renew); }
  finally { await realtime(path,{method:'PUT',token,etag:lease.tag,data:null}).catch(()=>{}); }
}

export async function publishCampaign(draft,token,disable = false) {
  const {slug} = draft;
  const visibleFrames = draft.frames.filter(frame => frame.enabled);
  if (!disable && !visibleFrames.length) throw Error('Enable at least one frame before publishing.');
  const path = 'visibility/'+slug;
  // Hide artwork while the Firestore snapshot is changed. A failure leaves artwork private.
  await realtime(path,{method:'PUT',token,data:null});
  try {
    if (disable) await removeLive(slug,token);
    else {
      await writeCampaign('live',slug,{
        title:draft.title,description:draft.description,frames:visibleFrames.map(({id,version,name})=>({id,version,name})),
        defaultId:visibleFrames.some(frame=>frame.id===draft.defaultId) ? draft.defaultId : visibleFrames[0].id
      },token);
      const frames = Object.fromEntries(visibleFrames.map(frame=>[frame.id,frame.version]));
      await realtime(path,{method:'PUT',data:{frames},token});
    }
  } catch (error) {
    throw Error('Publication did not finish. Retry to restore the live artwork or finish disabling it. '+error.message);
  }
}

let assetCache;

const pngPrefix = 'data:image/png;base64,';

function pngPayload(data,size) {
  if (typeof data !== 'string' || !data.startsWith(pngPrefix)) throw Error('Frame artwork is missing or invalid.');
  const payload = data.slice(pngPrefix.length);
  const header = atob(payload.slice(0,32));
  if (header.slice(0,16) !== '\x89PNG\r\n\x1a\n\0\0\0\rIHDR' || header.length !== 24) {
    throw Error('Frame artwork is not a valid PNG.');
  }
  const dimensions = new DataView(Uint8Array.from(header,byte=>byte.charCodeAt(0)).buffer);
  if (dimensions.getUint32(16) !== size || dimensions.getUint32(20) !== size) {
    throw Error('Frame artwork has unexpected dimensions.');
  }
  return payload;
}

function pngBlob(data,size) {
  const payload = pngPayload(data,size);
  let bytes;
  if (Uint8Array.fromBase64) bytes = Uint8Array.fromBase64(payload);
  else {
    const binary = atob(payload);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes],{type:'image/png'});
}

async function fetchArtwork(path,variant,token,signal) {
  const full = variant === 'full';
  const options = full ? {token,signal,stream:true,timeout:45000} : {token,signal};
  try { return await realtime(path,options); }
  catch (error) {
    signal?.throwIfAborted();
    if (!full || !error.retryable) throw error;
    await new Promise(resolve=>setTimeout(resolve,500));
    signal?.throwIfAborted();
    return realtime(path,options);
  }
}

export async function asset(slug,frame,variant,token,signal,decode = blob=>blob) {
  if (!['thumb','full'].includes(variant)) throw Error('Invalid artwork variant.');
  const path = artPath(slug,frame.id,frame.version,variant);
  const request = new URL('/.frame-cache/'+projectId+'/'+path,location.origin);
  // Only artwork discovered in a public snapshot is eligible for persistent caching.
  const cache = !token && globalThis.caches && await (assetCache ||= caches.open('studio-artwork-v1').catch(()=>null));
  signal?.throwIfAborted();
  if (cache) {
    const hit = await cache.match(request).catch(()=>null);
    if (hit) {
      try {
        const value = await decode(await hit.blob());
        signal?.throwIfAborted();
        return value;
      } catch {
        signal?.throwIfAborted();
        await cache.delete(request).catch(()=>{});
      }
    }
  }
  const {data} = await fetchArtwork(path,variant,token,signal);
  const blob = pngBlob(data,variant === 'full' ? 1080 : 240);
  const value = await decode(blob);
  signal?.throwIfAborted();
  if (cache) void remember(cache,request,blob).catch(()=>{});
  return value;
}

let cacheWrites = Promise.resolve();
function remember(cache,request,blob) {
  const job = cacheWrites.then(async () => {
    const keys = await cache.keys();
    for (const key of keys.slice(0,Math.max(0,keys.length-47))) await cache.delete(key);
    await cache.put(request,new Response(blob,{headers:{'Content-Type':'image/png'}}));
  });
  cacheWrites = job.catch(()=>{});
  return job;
}
