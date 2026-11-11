import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {dataDir} from './runtime.mjs';
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--owner'||args[2]!=='--guild'||![args[1],args[3]].every(x=>/^\d{17,20}$/.test(x))){
 console.error('Usage: npm run init -- --owner YOUR_DISCORD_USER_ID --guild YOUR_DISCORD_SERVER_ID');process.exit(1);
}
await mkdir(dataDir,{recursive:true,mode:0o700});
// Never replace an existing configuration or saved channel bindings.
await writeFile(join(dataDir,'config.json'),JSON.stringify({owner:args[1],guild:args[3],bindings:[]},null,2)+'\n',{flag:'wx',mode:0o600});
console.log('Created config.json in '+dataDir);
console.log('Save the Discord bot token as discord-token in that directory (mode 600).');
