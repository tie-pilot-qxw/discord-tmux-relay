import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),dir=await mkdtemp(join(tmpdir(),'relay-setup-'));
const run=(file,args=[])=>exec(process.execPath,[fileURLToPath(new URL(file,import.meta.url)),...args],{env:{...process.env,RELAY_DATA_DIR:dir}});
try{
 const args=['--owner','11111111111111111','--guild','22222222222222222'];
 await run('init.mjs',args);
 const config=await readFile(join(dir,'config.json'),'utf8');assert.deepEqual(JSON.parse(config).bindings,[]);
 await assert.rejects(()=>run('init.mjs',args));assert.equal(await readFile(join(dir,'config.json'),'utf8'),config);
 await writeFile(join(dir,'discord-token'),'test-fixture-not-a-credential');
 const {stdout}=await run('install-service.mjs',['--print']);
 assert.ok(stdout.includes('ExecStart=/usr/bin/flock -n'));
 assert.ok(stdout.includes('RELAY_DATA_DIR='+dir));
 assert.ok(!stdout.includes('test-fixture-not-a-credential'));
 console.log('PASS: fresh setup, existing config preserved, isolated data path, credential-free service output.');
}finally{await rm(dir,{recursive:true});}
