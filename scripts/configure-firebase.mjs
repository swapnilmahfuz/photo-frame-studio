import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

const project = 'kuetconvocationphotoframe27';
function runFirebase(args) {
  return JSON.parse(execFileSync('firebase',[...args,'--project',project,'--json','--non-interactive'],{encoding:'utf8'})).result;
}

const appId = process.argv[2];
const {sdkConfig:app} = runFirebase(['apps:sdkconfig','WEB',...(appId ? [appId] : [])]);
if (!app || app.projectId!==project || !app.apiKey || !app.authDomain) {
  throw Error('The Firebase CLI did not return the expected Web App configuration.');
}
if (!app.databaseURL) {
  const databases = runFirebase(['database:instances:list']).filter(db=>db.state==='ACTIVE' && db.databaseUrl);
  const selected = databases.find(db=>db.type?.toLowerCase()==='default_database') || (databases.length===1 && databases[0]);
  if (!selected) throw Error('Could not identify a single active Realtime Database. Set databaseURL in public/firebase-config.json using Firebase Console.');
  app.databaseURL = selected.databaseUrl;
}
await writeFile(new URL('../public/firebase-config.json',import.meta.url),JSON.stringify(app,null,2)+'\n');
console.log('Wrote the public Firebase Web App configuration.');
