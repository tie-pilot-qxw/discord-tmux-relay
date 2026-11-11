import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
export const dataDir=resolve(process.env.RELAY_DATA_DIR||join(homedir(),'.local/share/discord-tmux-relay'));
