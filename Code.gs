const SIZE = 1080;
const LIMIT = 8 * 1024 * 1024;
const props = () => PropertiesService.getScriptProperties();

function setupPlatform_() {
  const owner = Session.getActiveUser().getEmail().toLowerCase();
  if (!owner || owner !== Session.getEffectiveUser().getEmail().toLowerCase()) throw Error('Run setup as the project owner.');
  return locked_(() => {
    const p = props();
    if (p.getProperty('OWNER')) {
      owner_();
      return 'Already configured';
    }
    const db = SpreadsheetApp.create('Photo Frame Studio • Database');
    db.getSheets()[0].setName('Campaigns').appendRow(['Campaign JSON']);
    db.insertSheet('Frames').appendRow(['Frame JSON']);
    const folder = DriveApp.createFolder('Photo Frame Studio • Assets');
    const campaign = {id:key_(),slug:'kuet-4th-convocation-2027',title:'KUET 4th Convocation 2027',description:'Celebrate your graduation with a commemorative photo frame.',status:'published',logo:'',cover:'',defaultId:''};
    const frame = {id:key_(), campaign:campaign.id,name:'Emerald & Gold',order:0,enabled:true,count:0,file:seed_(folder)};
    campaign.defaultId = frame.id;
    db.getSheetByName('Campaigns').appendRow([JSON.stringify(campaign)]);
    db.getSheetByName('Frames').appendRow([JSON.stringify(frame)]);
    p.setProperties({OWNER:owner,DB:db.getId(),FOLDER:folder.getId()});
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
    frames:sorted_(frames.filter(f => f.campaign === c.id)).map(f => ({id:f.id,name:f.name}))
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
  if (kind === 'frame') {
    const frame = rows_(table_('Frames')).find(({data:f}) => f.id === frameId && f.campaign === campaign.id && !f.deleted && (admin || f.enabled));
    file = frame && frame.data.file;
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
  const frames = sorted_(rows_(table_('Frames')).map(x => x.data)).map(({file,events,...f}) => f);
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
    if (!row && !input.image) throw Error('Choose a transparent 1080 × 1080 PNG.');
    const existing = row ? row.data : {id:key_(),campaign:input.campaign,count:0,file:''};
    const enabled = input.enabled === true && input.delete !== true;
    if (existing.enabled && !enabled && campaign.data.status === 'published' &&
        !frames.some(({data:f}) => f.id !== existing.id && f.campaign === input.campaign && f.enabled && !f.deleted)) {
      throw Error('Disable the campaign before removing its last enabled frame.');
    }
    const update = {row:row && row.row,data:{...existing,name,order,enabled,deleted:input.delete === true}};
    if (input.image || update.data.deleted) replaceAsset_(sheet,update,'file',input.image,true);
    else write_(sheet,update.row,update.data);
    if (!enabled && campaign.data.defaultId === existing.id) {
      campaign.data.defaultId = '';
      write_(campaigns,campaign.row,campaign.data);
    }
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

function storeImage_(data,frame) {
  const match = typeof data === 'string' && data.length <= Math.ceil(LIMIT/3)*4+40 &&
    data.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Error('Choose a PNG or JPG under 8 MB.');
  const bytes = Utilities.base64Decode(match[2]);
  const b = i => bytes[i] & 255;
  const png = [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].every((v,i) => b(i) === v);
  const jpeg = b(0) === 255 && b(1) === 216 && b(2) === 255;
  const u32 = i => b(i)*16777216 + b(i+1)*65536 + b(i+2)*256 + b(i+3);
  if (bytes.length > LIMIT || !(match[1] === 'image/png' ? png : jpeg)) throw Error('Invalid image file.');
  if (frame && (!png || u32(16) !== SIZE || u32(20) !== SIZE || b(25) !== 6)) throw Error('Use a 1080 × 1080 PNG with an RGBA channel.');
  const extension = png ? '.png' : '.jpg';
  return DriveApp.getFolderById(props().getProperty('FOLDER')).createFile(Utilities.newBlob(bytes,match[1],key_()+extension)).getId();
}
