import {mkdir,writeFile,access} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dataDir} from './runtime.mjs';
if(process.platform!=='linux')throw Error('The relay service requires Linux.');
await access(join(dataDir,'config.json'));await access(join(dataDir,'discord-token'));await access('/usr/bin/flock');
const codeDir=dirname(fileURLToPath(import.meta.url));
// Quote literal systemd arguments, including paths with spaces/%/$ characters.
const quote=s=>'"'+s.replace(/%/g,'%%').replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n')+'"';
const execQuote=s=>quote(s).replace(/\$/g,()=> '$$');
const unit=`[Unit]
Description=Discord relay for existing tmux model terminals
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${quote(codeDir)}
Environment=${quote('PATH='+dirname(process.execPath)+':/usr/local/bin:/usr/bin:/bin')}
Environment=${quote('RELAY_DATA_DIR='+dataDir)}
ExecStart=/usr/bin/flock -n ${execQuote(join(dataDir,'relay.lock'))} ${execQuote(process.execPath)} ${execQuote(join(codeDir,'bridge.mjs'))}
Restart=on-failure
RestartSec=5
UMask=0077
TimeoutStopSec=10

[Install]
WantedBy=default.target
`;
if(process.argv.includes('--print')){process.stdout.write(unit);process.exit(0);}
const unitDir=join(homedir(),'.config/systemd/user');await mkdir(unitDir,{recursive:true});
const path=join(unitDir,'discord-tmux-relay.service');await writeFile(path,unit,{mode:0o600});
console.log('Wrote '+path+'; not started yet.');
console.log('Run: systemctl --user daemon-reload && systemctl --user enable --now discord-tmux-relay.service');
