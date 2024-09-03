let webTorrentRunning = false;
let active = false;
let initialyActive = false;
let overlayText = '';
let playlist: string[] = [];

// Sync with options in webtorrent.node.ts
const options = {
  path: './',
  maxConns: 100,
  port: 8888,
  utp: true,
  dht: true,
  lsd: true,
  downloadLimit: -1,
  uploadLimit: -1,

  // Text style. from stats.lua
  font: 'sans',
  font_mono: 'monospace',
  font_size: 8,
  font_color: 'FFFFFF',
  border_size: 0.8,
  border_color: '262626',
  shadow_x_offset: 0.0,
  shadow_y_offset: 0.0,
  shadow_color: '000000',
  alpha: '11',

  // Node
  node_path: 'node'
};

mp.options.read_options(options);

options.path = mp.command_native<string>(['expand-path', options.path], "") as string;

function keyPressHandler() {
  if (active || initialyActive) {
    clearOverlay();
  } else {
    showOverlay();
  }
}

function showOverlay() {
  initialyActive = false;
  active = true;
  printOverlay();
}

function printOverlay() {
  if (!overlayText) {
    return;
  }
  if (active || initialyActive) {
    const expanded = mp.command_native<string>(['expand-text', overlayText], "") as string;
    mp.osd_message(expanded, 10);
  }
}

function clearOverlay() {
  active = false;
  initialyActive = false;
  mp.osd_message('', 0);
}

function openPlaylist() {
  for (let i = 0; i < playlist.length; i++) {
    const item = playlist[i];
    if (!item) {
      continue;
    }
    if (i === 0) {
      mp.commandv('loadfile', item);
    } else {
      mp.commandv('loadfile', item, 'append');
    }
  }
}

function onData(_data: unknown) {
  overlayText = _data as string;
  printOverlay();
}

function onPlaylist(_playlist: unknown) {
  playlist = JSON.parse(_playlist as string) as string[];
  openPlaylist();
}

function onInfo(..._info: unknown[]) {
  mp.msg.info(..._info as string[]);
}

function onFileLoaded() {
  initialyActive = false;
  if (!active) {
    clearOverlay();
  }
}

function onIdleActiveChange(name: string, idleActive?: boolean) {
  if (idleActive && playlist.length) {
    mp.set_property('pause', 'yes');
    setTimeout(openPlaylist, 1000);
  }
}

function onLoadHook() {
  const url = mp.get_property('stream-open-filename', '');

  try {
    if (/^magnet:/i.test(url)) {
      runHook(url);
    } else if (/\.torrent$/i.test(url)) {
      runHook(url);
    } else if (/^[0-9A-F]{40}$/i.test(url)) {
      runHook(url);
    } else if (/^[0-9A-Z]{32}$/i.test(url)) {
      runHook(url);
    }
  } catch (_e) {
    const e = _e as Error;
    mp.msg.error(e.message)
  }
}

function runHook(url: string) {
  mp.msg.info('Running WebTorrent hook');
  mp.set_property('stream-open-filename', 'null://');
  if (webTorrentRunning) {
    throw new Error('WebTorrent already running. Only one instance is allowed.');
  }

  const socketName = getSocketName();
   
  const scriptPath = getNodeScriptPath();
  
  webTorrentRunning = true;
  initialyActive = true;

  mp.set_property('idle', 'yes');
  mp.set_property('force-window', 'yes');
  mp.set_property('keep-open', 'yes');

  mp.register_script_message('osd-data', onData);
  mp.register_script_message('playlist', onPlaylist);
  mp.register_script_message('info', onInfo);
  mp.register_event('file-loaded', onFileLoaded);
  mp.observe_property('idle-active', 'bool', onIdleActiveChange);

  const args = {
    torrentId: url,
    socketName,
    ...options
  };

  mp.command_native_async({
    name: 'subprocess',
    args: [options.node_path, scriptPath, JSON.stringify(args)],
    playback_only: false,
    capture_stderr: true
  }, onWebTorrentExit);

  mp.add_key_binding('p', 'toggle-info', keyPressHandler);
}

function getSocketName(): string {
  let socketName = mp.get_property('input-ipc-server');
  if (!socketName) {
    mp.set_property('input-ipc-server', `/tmp/webtorrent-mpv-hook-socket-${mp.utils.getpid()}-${Date.now()}`);
    socketName = mp.get_property('input-ipc-server');
  }

  if (!socketName) {
    throw new Error(`Couldn't get input-ipc-server`);
  }

  return socketName;
}

function getNodeScriptPath(): string {
  const realPath = mp.command_native({
    name: 'subprocess',
    args: [options.node_path, '-p', `require('fs').realpathSync('${mp.get_script_file().replace(/\\/g, '\\\\')}')`],
    playback_only: false,
    capture_stdout: true
  });

  try {
    const scriptPath = realPath.stdout.split(/\r\n|\r|\n/)?.[0]?.replace(/webtorrent\.js$/, 'webtorrent.node.js');
    if (!scriptPath) {
      throw new Error();
    }
    return scriptPath;
  } catch {
    throw new Error(`Failed to get node script path. Possible causes are "${options.node_path}" not available in path or incorrect symlink.`);
  }
}

function onWebTorrentExit(success: boolean, _result: unknown): void {
  webTorrentRunning = false;
  overlayText = '';
  clearOverlay();

  const result = _result as mp.CapturedProcess;
  if (!success) {
    mp.msg.error('Failed to start WebTorrent');
  } else if (result.stderr) {
    mp.msg.error(result.stderr);
  } else if (result.status) {
    mp.msg.error('WebTorrent exited with error');
  }

  mp.unregister_script_message('osd-data');
  mp.unregister_script_message('playlist');
  mp.unregister_script_message('info');
  mp.unregister_event(onFileLoaded);
  mp.unobserve_property(onIdleActiveChange as (...args: unknown[]) => void);
  mp.remove_key_binding('toggle-info');
}

mp.add_hook('on_load', 50, onLoadHook);