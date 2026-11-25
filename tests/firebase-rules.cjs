const {assertFails,assertSucceeds,initializeTestEnvironment} = require('@firebase/rules-unit-testing');
const {getDoc,setDoc,deleteDoc,getDocs,doc,collection} = require('firebase/firestore');
const {get,set,remove,ref} = require('firebase/database');
const {readFileSync} = require('node:fs');
const assert = require('node:assert/strict');

async function main() {
  const env = await initializeTestEnvironment({
    projectId:'demo-photo-frame-studio',
    firestore:{host:'127.0.0.1',port:8187,rules:readFileSync('firestore.rules','utf8')},
    database:{host:'127.0.0.1',port:9197,rules:readFileSync('database.rules.json','utf8')}
  });
  const email = 'swapnilmahfuz20@gmail.com';
  const google = {sign_in_provider:'google.com',identities:{}};
  const owner = env.authenticatedContext('owner',{email,email_verified:true,firebase:google});
  const anonymous = env.unauthenticatedContext();
  const outsiders = [
    anonymous,
    env.authenticatedContext('outsider',{email:'someone@example.test',email_verified:true,firebase:google}),
    env.authenticatedContext('fake-email',{email,email_verified:false,firebase:google}),
    env.authenticatedContext('non-google',{email,email_verified:true,firebase:{sign_in_provider:'password',identities:{}}})
  ];
  const slug = 'kuet-4th-convocation-2027';
  const frame = {id:'frame-1',version:'v1',name:'Starter',enabled:true};
  const entry = {title:'KUET',description:'Test',frames:[frame],defaultId:frame.id};
  const path = 'art/'+slug+'/'+frame.id+'/';
  const gate = 'visibility/'+slug;
  const lock = 'locks/'+slug;
  const png = 'data:image/png;base64,'+readFileSync('public/art/kuet-starter.png','base64');
  try {
    await env.clearFirestore();
    await env.clearDatabase();
    await assertSucceeds(setDoc(doc(owner.firestore(),'drafts',slug),entry));
    await assertSucceeds(set(ref(owner.database(),path+'v1'),{full:png,thumb:png}));
    await assertSucceeds(set(ref(owner.database(),path+'v2'),{full:png,thumb:png}));
    for (const outsider of outsiders) {
      const fs = outsider.firestore();
      const db = outsider.database();
      await assertFails(getDoc(doc(fs,'drafts',slug)));
      await assertFails(getDocs(collection(fs,'drafts')));
      await assertFails(setDoc(doc(fs,'drafts',slug),entry));
      await assertFails(setDoc(doc(fs,'live',slug),entry));
      await assertFails(get(ref(db,path+'v1/full')));
      await assertFails(set(ref(db,path+'v1'),{full:png,thumb:png}));
      await assertFails(set(ref(db,gate),{frames:{'frame-1':'v1'}}));
      await assertFails(set(ref(db,lock),{operation:'x'}));
    }
    await assertSucceeds(setDoc(doc(owner.firestore(),'live',slug),entry));
    await assertSucceeds(set(ref(owner.database(),gate),{frames:{'frame-1':'v1'}}));
    const publicFs = anonymous.firestore();
    const publicDb = anonymous.database();
    assert.equal((await assertSucceeds(getDoc(doc(publicFs,'live',slug)))).exists(),true);
    assert.equal((await assertSucceeds(getDocs(collection(publicFs,'live')))).size,1);
    assert.equal((await assertSucceeds(get(ref(publicDb,path+'v1/full')))).val(),png);
    await assertSucceeds(get(ref(publicDb,path+'v1/thumb')));
    await assertFails(get(ref(publicDb,path+'v1')));
    await assertFails(get(ref(publicDb,'art/'+slug)));
    await assertFails(get(ref(publicDb,path+'v2/thumb')));
    await assertFails(get(ref(publicDb,gate)));
    await assertFails(deleteDoc(doc(publicFs,'live',slug)));
    await assertFails(set(ref(owner.database(),path+'invalid'),{full:'not PNG'}));
    await assertFails(set(ref(owner.database(),path+'invalid'),{elsewhere:png}));
    await assertSucceeds(set(ref(owner.database(),gate),{frames:{'frame-1':'v2'}}));
    await assertFails(get(ref(publicDb,path+'v1/full')));
    await assertSucceeds(get(ref(publicDb,path+'v2/full')));
    await assertSucceeds(remove(ref(owner.database(),gate)));
    await assertSucceeds(deleteDoc(doc(owner.firestore(),'live',slug)));
    assert.equal((await assertSucceeds(getDoc(doc(publicFs,'live',slug)))).exists(),false);
    await assertFails(get(ref(publicDb,path+'v2/full')));
    console.log('Firestore and RTDB rules passed for owner, anonymous, other Google user, unverified email, and non-Google provider.');
  } finally { await env.cleanup(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
