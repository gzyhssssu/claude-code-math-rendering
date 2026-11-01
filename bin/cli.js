#!/usr/bin/env node
import { resolveProfile, defaultStateDir } from '../src/platform.js';
import { inspect, summary, install, restore } from '../src/service.js';
import { prepareNative } from '../src/native-package.js';

const help = `Claude Code Math Rendering / Claude Code 公式渲染 (Windows; Node.js 24+)

  node bin/cli.js doctor [--profile PATH]
  node bin/cli.js install [--profile PATH] [--state-dir PATH]
  node bin/cli.js restore [--profile PATH] [--state-dir PATH] [--backup ID]
  node bin/cli.js native-prepare --app-dir PATH --output PATH

Quit Claude Desktop from its tray before install or restore.
doctor only reads recognized cached rendering modules. Nothing is downloaded or uploaded.
Backups stay in the local state directory, outside this checkout.
native-prepare only prepares local files; see docs/native-runtime.md before installation.
Native installation changes Claude.exe's signature and needs Windows administrator access.
`;
function main(args) {
  const command = args.shift();
  if (!command || command === '--help' || command === '-h') { console.log(help); return; }
  if (!['doctor', 'install', 'restore', 'native-prepare'].includes(command)) throw new Error('Unknown command. Use --help.');
  const options = {};
  while (args.length) {
    const name = args.shift();
    const allowed = command === 'native-prepare' ? ['--app-dir', '--output'] : ['--profile', '--state-dir', '--backup'];
    if (!allowed.includes(name) || !args.length || args[0].startsWith('--') || options[name]) throw new Error('Invalid or duplicate option: ' + name);
    options[name] = args.shift();
  }
  if (command === 'native-prepare') {
    if (!options['--app-dir'] || !options['--output']) throw new Error('native-prepare requires --app-dir and --output.');
    console.log(JSON.stringify(prepareNative(options['--app-dir'], options['--output']), null, 2));
    return;
  }
  const profile = resolveProfile(options['--profile']);
  const state = options['--state-dir'] || defaultStateDir();
  let result;
  if (command === 'doctor') result = summary(inspect(profile));
  else if (command === 'install') result = install(profile, state);
  else result = restore(profile, state, { backupId: options['--backup'] });
  console.log(JSON.stringify(result, null, 2));
}
try { main(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
