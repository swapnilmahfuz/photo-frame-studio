const LIMIT = 8 * 1024 * 1024;
const props = () => PropertiesService.getScriptProperties();

function setupPlatform() {
  const owner = Session.getActiveUser().getEmail().toLowerCase();
  if (!owner || owner !== Session.getEffectiveUser().getEmail().toLowerCase()) throw Error('Run setup as the project owner.');
  return locked_(() => {
    const p = props();
    if (p.getProperty('OWNER')) {
      owner_();
      console.log('Already configured');
      return 'Already configured';
    }
    if (ScriptApp.getService().getUrl()) throw Error('Run setupPlatform from the editor before deploying the web app.');
    const db = SpreadsheetApp.create('Photo Frame Studio • Database');
    db.getSheets()[0].setName('Campaigns').appendRow(['Campaign JSON']);
    db.insertSheet('Frames').appendRow(['Frame JSON']);
    const folder = DriveApp.createFolder('Photo Frame Studio • Assets');
    const campaign = {id:key_(),slug:'kuet-4th-convocation-2027',title:'KUET 4th Convocation 2027',description:'Celebrate your graduation with a commemorative photo frame.',status:'published',logo:'',cover:'',defaultId:''};
    const frame = {id:key_(), campaign:campaign.id,name:'Emerald & Gold',order:0,enabled:true,count:0,file:seed_(folder)};
    campaign.defaultId = frame.id;
    db.getSheetByName('Campaigns').appendRow([JSON.stringify(campaign)]);
    db.getSheetByName('Frames').appendRow([JSON.stringify(frame)]);
    SpreadsheetApp.flush();
    p.setProperties({OWNER:owner,DB:db.getId(),FOLDER:folder.getId()});
    console.log('Configured');
    return 'Configured';
  });
}

function doGet(e) {
  const q = e && e.parameter || {};
  const page = HtmlService.createTemplateFromFile('Index');
  const admin = q.view === 'admin';
  let mode = 'public';
  if (admin) {
    try { owner_(); mode = 'admin'; } catch (error) { mode = 'denied'; }
  }
  page.boot = JSON.stringify({mode,slug:String(q.campaign || '').slice(0,100),url:props().getProperty('PUBLIC_URL') || ''}).replace(/</g,'\\u003c');
  return page.evaluate().setTitle('Photo Frame Studio').addMetaTag('viewport','width=device-width, initial-scale=1');
}

function owner_() {
  const expected = props().getProperty('OWNER');
  const active = Session.getActiveUser().getEmail().toLowerCase();
  const effective = Session.getEffectiveUser().getEmail().toLowerCase();
  if (!expected || active !== expected || effective !== expected) throw Error('Owner access required.');
}

function key_() { return Utilities.getUuid(); }

function table_(name) {
  const id = props().getProperty('DB');
  if (!id) throw Error('The platform is awaiting owner setup.');
  return SpreadsheetApp.openById(id).getSheetByName(name);
}

function rows_(sheet) {
  const count = sheet.getLastRow() - 1;
  return count ? sheet.getRange(2,1,count,1).getValues().map(([value], index) => ({row:index + 2,data:JSON.parse(value)})) : [];
}

function write_(sheet, row, data) {
  const value = JSON.stringify(data);
  if (row) sheet.getRange(row,1).setValue(value);
  else sheet.appendRow([value]);
}

function locked_(work) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return work(); } finally {
    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  }
}

function sorted_(frames) {
  return frames.sort((a,b) => a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function publicCatalog() {
  const campaigns = rows_(table_('Campaigns')).map(x => x.data).filter(x => x.status === 'published');
  const frames = rows_(table_('Frames')).map(x => x.data).filter(x => x.enabled && !x.deleted);
  return campaigns.map(c => ({
    id:c.id,slug:c.slug,title:c.title,description:c.description,logo:!!c.logo,cover:!!c.cover,defaultId:c.defaultId,
    frames:sorted_(frames.filter(f => f.campaign === c.id)).map(f => ({id:f.id,name:f.name,hasThumbnail:!!f.thumbnail}))
  }));
}

function publicAsset(campaignId, kind, frameId) {
  const campaign = rows_(table_('Campaigns')).find(x => x.data.id === campaignId && x.data.status === 'published');
  if (!campaign) throw Error('Campaign unavailable.');
  return asset_(campaign.data,kind,frameId,false);
}

function adminAsset(campaignId, kind, frameId) {
  owner_();
  const campaign = rows_(table_('Campaigns')).find(x => x.data.id === campaignId);
  if (!campaign) throw Error('Campaign unavailable.');
  return asset_(campaign.data,kind,frameId,true);
}

function asset_(campaign,kind,frameId,admin) {
  let file;
  if (kind === 'logo' || kind === 'cover') file = campaign[kind];
  if (kind === 'frame' || kind === 'thumbnail') {
    const frame = rows_(table_('Frames')).find(({data:f}) => f.id === frameId && f.campaign === campaign.id && !f.deleted && (admin || f.enabled));
    file = frame && frame.data[kind === 'thumbnail' ? 'thumbnail' : 'file'];
  }
  if (!file) throw Error('Image unavailable.');
  const blob = DriveApp.getFileById(file).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

function recordExport(campaignId,frameId,eventId) {
  if (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId)) throw Error('Invalid export.');
  return locked_(() => {
    const campaign = rows_(table_('Campaigns')).find(({data:c}) => c.id === campaignId && c.status === 'published');
    const sheet = table_('Frames');
    const item = rows_(sheet).find(({data:f}) => f.id === frameId && f.campaign === campaignId && f.enabled && !f.deleted);
    if (!campaign || !item) return false;
    const f = item.data;
    const recent = f.events || [];
    if (recent.includes(eventId)) return true;
    f.count += 1;
    f.events = recent.concat(eventId).slice(-100);
    write_(sheet,item.row,f);
    return true;
  });
}

function adminState() {
  owner_();
  const campaigns = rows_(table_('Campaigns')).map(({data:c}) => ({...c,logo:!!c.logo,cover:!!c.cover}));
  const frames = sorted_(rows_(table_('Frames')).map(x => x.data)).map(({file,events,thumbnail,...f}) => ({...f,hasThumbnail:!!thumbnail}));
  return {campaigns,frames,url:props().getProperty('PUBLIC_URL') || ''};
}

function setPublicUrl(value) {
  owner_();
  const url = String(value).trim();
  if (!/^https:\/\/script\.google\.com\/(?:a\/macros\/[a-z0-9.-]+\/|macros\/)s\/[\w-]+\/exec$/i.test(url)) throw Error('Enter the public Apps Script /exec URL.');
  props().setProperty('PUBLIC_URL',url);
}

function saveCampaign(input) {
  owner_();
  return locked_(() => {
    const sheet = table_('Campaigns');
    const all = rows_(sheet);
    const row = all.find(x => x.data.id === input.id);
    if (input.id && !row) throw Error('Campaign unavailable.');
    const title = field_(input.title,100);
    const description = field_(input.description,2000,true);
    const slug = row ? row.data.slug : field_(input.slug,80).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || all.some(x => x.data.slug === slug && x !== row)) throw Error('Use a unique slug with letters, numbers and hyphens.');
    if (!['draft','published','disabled'].includes(input.status)) throw Error('Invalid status.');
    const existing = row ? row.data : {id:key_(),logo:'',cover:''};
    const frames = rows_(table_('Frames')).map(x => x.data).filter(f => f.campaign === existing.id && f.enabled && !f.deleted);
    if (input.status === 'published' && !frames.length) throw Error('Enable at least one frame before publishing.');
    if (input.defaultId && !frames.some(f => f.id === input.defaultId)) throw Error('Select an enabled default frame.');
    write_(sheet,row && row.row,{...existing,title,description,slug,status:input.status,defaultId:input.defaultId || ''});
    return existing.id;
  });
}

function saveBrand(campaignId,kind,image) {
  owner_();
  if (!['logo','cover'].includes(kind)) throw Error('Invalid image type.');
  return locked_(() => {
    const sheet = table_('Campaigns');
    const row = rows_(sheet).find(x => x.data.id === campaignId);
    if (!row) throw Error('Campaign unavailable.');
    replaceAsset_(sheet,row,kind,image,false);
  });
}

function saveFrame(input) {
  owner_();
  const name = field_(input.name,100);
  const order = Number(input.order);
  if (!Number.isInteger(order) || order < 0 || order > 1000000) throw Error('Invalid display order.');
  return locked_(() => {
    const campaigns = table_('Campaigns');
    const campaign = rows_(campaigns).find(x => x.data.id === input.campaign);
    if (!campaign) throw Error('Campaign unavailable.');
    const sheet = table_('Frames');
    const frames = rows_(sheet);
    const row = frames.find(({data:f}) => f.id === input.id && f.campaign === input.campaign && !f.deleted);
    if (input.id && !row) throw Error('Frame unavailable.');
    if (!row && !input.image) throw Error('Choose a square PNG frame with transparency (up to 8 MB).');
    const existing = row ? row.data : {id:key_(),campaign:input.campaign,count:0,file:''};
    const enabled = input.enabled === true && input.delete !== true;
    if (existing.enabled && !enabled && campaign.data.status === 'published' &&
        !frames.some(({data:f}) => f.id !== existing.id && f.campaign === input.campaign && f.enabled && !f.deleted)) {
      throw Error('Disable the campaign before removing its last enabled frame.');
    }
    const update = {row:row && row.row,data:{...existing,name,order,enabled,deleted:input.delete === true}};
    if (input.image || update.data.deleted) replaceFrameAssets_(sheet,update,input);
    else write_(sheet,update.row,update.data);
    if (!enabled && campaign.data.defaultId === existing.id) {
      campaign.data.defaultId = '';
      write_(campaigns,campaign.row,campaign.data);
    }
  });
}

function replaceFrameAssets_(sheet,row,input) {
  const previous = [row.data.file,row.data.thumbnail];
  const next = [];
  try {
    if (!row.data.deleted && input.image) {
      next.push(storeImage_(input.image,true));
      if (input.thumbnail) next.push(storeImage_(input.thumbnail,true,240));
    }
    row.data.file = next[0] || '';
    row.data.thumbnail = next[1] || '';
    row.data.revision = key_();
    write_(sheet,row.row,row.data);
    SpreadsheetApp.flush();
  } catch (error) {
    next.forEach(trash_);
    throw error;
  }
  previous.filter(Boolean).forEach(trash_);
}

function saveMissingThumbnail(campaignId,frameId,revision,image) {
  owner_();
  return locked_(() => {
    const sheet = table_('Frames');
    const row = rows_(sheet).find(({data:f}) => f.campaign === campaignId && f.id === frameId && !f.deleted);
    if (!row || row.data.thumbnail || (row.data.revision || '') !== revision) return false;
    const thumbnail = storeImage_(image,true,240);
    try {
      row.data.thumbnail = thumbnail;
      write_(sheet,row.row,row.data);
      SpreadsheetApp.flush();
    } catch (error) {
      trash_(thumbnail);
      throw error;
    }
    return true;
  });
}

function replaceAsset_(sheet,row,field,image,frame) {
  const oldId = row.data[field];
  const newId = image ? storeImage_(image,frame) : '';
  row.data[field] = newId;
  try { write_(sheet,row.row,row.data); SpreadsheetApp.flush(); }
  catch (error) { if (newId) trash_(newId); throw error; }
  if (oldId) trash_(oldId);
}

function trash_(id) {
  try { DriveApp.getFileById(id).setTrashed(true); } catch (error) { console.warn(String(error)); }
}

function field_(value,max,optional) {
  const text = typeof value === 'string' ? value.trim() : '';
  if ((!optional && !text) || text.length > max) throw Error('Check required fields and length limits.');
  return text;
}

function storeImage_(data,frame,thumbnailSize) {
  const match = typeof data === 'string' && data.length <= Math.ceil(LIMIT/3)*4+40 &&
    data.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Error(frame ? 'Choose a square PNG frame with transparency (up to 8 MB).' : 'Choose a PNG or JPG up to 8 MB.');
  const bytes = Utilities.base64Decode(match[2]);
  const b = i => bytes[i] & 255;
  const png = [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].every((v,i) => b(i) === v);
  const jpeg = b(0) === 255 && b(1) === 216 && b(2) === 255;
  const u32 = i => b(i)*16777216 + b(i+1)*65536 + b(i+2)*256 + b(i+3);
  if (bytes.length > LIMIT || !(match[1] === 'image/png' ? png : jpeg)) throw Error('Invalid image file.');
  if (frame && (!png || !u32(16) || u32(16) !== u32(20) || b(25) !== 6)) throw Error('Use a square PNG frame with transparency.');
  if (thumbnailSize && u32(16) !== thumbnailSize) throw Error('Invalid thumbnail dimensions.');
  const extension = png ? '.png' : '.jpg';
  return DriveApp.getFolderById(props().getProperty('FOLDER')).createFile(Utilities.newBlob(bytes,match[1],key_()+extension)).getId();
}

function seed_(folder) {
  const png = 'iVBORw0KGgoAAAANSUhEUgAABDgAAAQ4CAMAAADbzpy9AAAAkFBMVEUAAAAQPjDmvGb+8dMWQzPx58qYpY1OaU5xiHM9YE8wV0bY1bm2u6HIya4lTDkqUT1admKstJuKmoOOiVCAk33Ws2KomFekrpXEqF7j3cFifGhxd0idkVS9wad9kHrNrWBScV26olvg279JYD5CXD1gbkQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADx527LAAAAMHRSTlMA/////////////////////////////////////////////////wAAAAAAAAAAAAAmoUR3AAAYPUlEQVR42u3d6WKa2gKA0VhBjFPUxIxNp9P7/q94q5gEZYMbHKLtWv/aoCDCJyDgVQegoSuzABAOQDgA4QCEAxAOAOEAhAMQDkA4AOEAEA5AOADhAIQDEA4A4QCEAxAOQDgA4QCEA0A4AOEAhAMQDkA4AIQDOHE4vgD/KOEAhAMQDuDvC8cV8I8RDkA4AOEAhAMQDuEA4RAOQDgA4QCEAxAOQDiEAxAOQDgA4QCEAxAO4QCEAxAOQDgA4QCEQzhAOIQDEA5AOADhAIRDOEA4hAMQDkA4AOEAhAMQDuEAhAMQDkA4AOEAhEM4AOEAhAMQDkA4AOEQDhAO4QCEAxAOQDgA4QCEQzgA4QCEAxAOQDgA4RAOQDgA4QCEAxAOQDiEAxAOQDgA4QCEAxAO4QDhEA5AOADhAIQDEA5AOIQDEA5AOADhAIQDEA7hAIQDEA5AOADhAIRDOADhAIQDEA5AOADhEA4QDuEAhAMQDkA4AOEAhEM4AOEAhAMQDkA4AOEQDkA4AOEAhAMQDkA4hAOEQzgA4QCEAxAOQDiEA4RDOADhAIQDEA5AOADhEA5AOADhAIQDEA5AOIQDEA5AOADhAIQDEA7hAOEQDkA4AOEAhAMQDjMRhEM4AOEAhAMQDkA4AOEQDkA4AOEAhAMQDkA4hAMQDkA4AOEAhAMQDuEA4RAOQDgA4QCEAxAOQDiEAxAOQDgA4QCEAxAO4QCEAxAOQDgA4QCEQzgA4QCEAxAOQDgA4RAOEA7hAIQDEA5AOADhAIRDOADhAIQDEA5AOADhEA5AOADhAIQDEA5AOIQDhEM4AOEAhAMQDkA4hAOEQzgA4QCEAxAOQDgA4RAOQDgA4QCEAxAOQDiEAxAOQDgA4QCEAxAO4QDhEA5AOADhAIQDEA7hAOEQDkA4AOEAhAMQDkA4hAMQDkA4AOEAhAMQDuEAhAMQDkA4AOEAhEM4QDiEAxAOQDgA4QCEAxAO4QCEAxAOQDgA4QCEQzgA4QCEAxAOQDgA4RAOQDgA4QCEAxAOQDiEA4RDOADhAIQDEA5AOADhEA5AOADhAIQDEA5AOIQDEA5AOADhAIQDEA7hAIQDEA5AOADhAIRDOEA4hAMQDkA4AOEAhAMQDuEAhAMQDkA4AOEAhEM4AOEAhAMQDkA4AOEQDhAO4QCEAxAOQDgA4RAOEA7hAIQDEA5AOADhAIRDOADhAIQDEA5AOADhEA5AOADhAIQDEA5AOIQDhEM4AOEAhAMQDkA4AOEQDkA4AOEAhAMQDkA4hAMQDkA4AOEAhAMQDuEAhAMQDkA4AOEAhEM4QDiEAxAOQDgA4QCEAxAO4QCEAxAOQDgA4QCEQzgA4QCEAxAOQDgA4RAOQDgA4QCEAxAOQDiEA4RDOADhAIQDEA5AOADhEA5AOADhAIQDEA5AOIQDEA5AOADhAIQDEA7hAOEQDkA4AOEAhAMQDuEA4RAOQDgA4QCEAxAOQDiEAxAOQDgA4QCEAxAO4QCEAxAOQDgA4QCEQzhAOIQDEA5AOADhAITDTAThEA5AOADhAIQDEA5AOIQDEA5AOADhAIQDEA7hAIQDEA5AOADhAIRDOEA4hAMQDkA4AOEAhAMQDuEAhAMQDkA4AOEAhEM4AOEAhAMQDkA4AOEQDkA4AOEAhAMQDkA4hAOEQzgA4QCEAxAOQDgA4RAOQDgA4QCEAxAOQDiEAxAOQDgA4QCEAxAO4QDhEA5AOADhAIQDEA7hAOEQDkA4AOEAhAMQDkA4hAMQDkA4AOEAhAMQDuEAhAMQDkA4AOEAhEM4QDiEAxAOQDgA4QCEQzhAOIQDEA5AOADhAIQDEA7hAIQDEA5AOADhAIRDOADhAIQDEA5AOADhEA4QDuEAhAMQDkA4AOEAhEM4AOEAhAMQDkA4AOEQDkA4AOEAhAMQDkA4hAMQDkA4AOEAhAMQDuEA4RAOQDgA4QCEAxAOQDiEAxAOQDgA4QCEAxAO4QCEAxAOQDgA4QCEQzgA4QCEAxAOQDgA4RAOEA7hAIQDEA5AOADhAIRDOADhAIQDEA5AOADhEA5AOADhAIQDEA5AOIQDhEM4AOEAhAMQDkA4hAOEQzgA4QCEAxAOQDgA4RAOQDgA4QCEAxAOQDiEAxAOQDgA4QCEAxAO4QDhEA5AOADhAIQDEA5AOIQDEA5AOADhAIQDEA7hAIQDEA5AOADhAIRDOADhAIQDEA5AOADhEA4QDuEAhAMQDkA4AOEAhEM4AOEAhAMQDkA4AOEQDkA4AOEAhAMQDkA4hAMQDkA4AOEAhAMQDuEA4RAOQDgA4QCEAxAOQDiEAxAOQDgA4QCEAxAO4QCEAxAOQDgA4QCEQzhAOIQDEA5AOADhAIRDOEA4hAMQDkA4AOEAhAMQDuEAhAMQDkA4AOEAhEM4AOEAhAMQDkA4AOEQDhAO4QCEAxAOQDgA4TATQTiEAxAOQDgA4QCEAxAO4QCEAxAOQDgA4QCEQzgA4QCEAxAOQDgA4RAOEA7hAIQDEA5AOADhAIRDOADhAIQDEA5AOADhEA5AOADhAIQDEA5AOIQDEA5AOADhAIQDEA7hAOEQDkA4AOEAhAMQDkA4hAMQDkA4AOEAhAMQDuEAhAMQDkA4AOEAhEM4QDiEAxAOQDgA4QCEQzhAOIQDEA5AOADhAIQDEA7hAIQDEA5AOADhAIRDOADhAIQDEA5AOADhEA4QDuEAhAMQDkA4AOEQDhAO4QCEAxAOQDgA4QCEQzgA4QCEAxAOQDgA4RAOQDgA4QCEAxAOQDiEA4RDOADhAIQDEA5AOADhEA5AOADhAIQDEA5AOIQDEA5AOADhAIQDEA7hAIQDEA5AOADhAIRDOEA4hAMQDkA4AOEAhAMQDuEAhAMQDkA4AOEAhEM4AOEAhAMQDkA4AOEQDkA4AOEAhAMQDkA4hAOEQzgA4QCEAxAOQDgA4RAOQDgA4QCEAxAOQDiEAxAOQDgA4QCEAxAO4QDhEA5AOADhAIQDEA7hAOEQDkA4AOEAhAMQDkA4hAMQDkA4AOEAhAMQDuEAhAMQDkA4AOEAhEM4QDiEAxAOQDgA4QCEAxAO4QCEAxAOQDgA4QCEQzgA4QCEAxAOQDgA4RAOQDgA4QCEAxAOQDiEA4RDOADhAIQDEA5AOADhEA5AOADhAIQDEA5AOIQDEA5AOADhAIQDEA7hAIQDEA5AOIC/MBxv8QD+JTuzIByAcADCAQgH8G+EA0A4AOEAhAMQDkA4AIQDEA5AOADhAIQDEA4A4QCEAxAOQDgA4QAQDkA4gEsN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';
  return folder.createFile(Utilities.newBlob(Utilities.base64Decode(png), 'image/png', 'KUET Emerald and Gold.png')).getId();
}
