#!/usr/bin/env node

import path from 'path';
import os from 'os';
import fs from 'fs';

const target = path.join(__dirname, '..', 'build', 'webtorrent.js');
const link = path.join(getScriptFolder(), 'webtorrent.js');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')) as {version: string};

console.log([
  `webtorrent-mpv-hook v${pkg.version}`,
  '',
  'You need to symlink the script file to your mpv scripts folder:',
  '',
  `  ${os.platform() === 'win32' ? `mklink "${link}" "${target}"\n  or\n  New-Item -ItemType SymbolicLink -Path "${link}" -Target "${target}"` : `ln -s "${target}" "${link}"`}`,
  '',
  'You can then run "mpv <torrent-id>" to start streaming.',
  ''
].join('\n'));

function getScriptFolder() {
  let mpvHome;

  if (os.platform() === 'win32') {
    mpvHome = process.env['MPV_HOME'] || '%APPDATA%/mpv';
  } else {
    mpvHome = process.env['MPV_HOME'];
    if (!mpvHome) {
      const xdgConfigHome = process.env['XDG_CONFIG_HOME'] || '$HOME/.config';
      mpvHome = path.join(xdgConfigHome, 'mpv');
    }
  }

  return path.join(mpvHome, 'scripts');
}