interface SubprocessResult {
  stdout: string;
  stderr: string;
  status: number;
}

const assStart = mp.get_property_osd('osd-ass-cc/0');
const assStop = mp.get_property_osd('osd-ass-cc/1');

let orgIdle: string | undefined;
let orgForceWindow: string | undefined;

let active = false;
let waiting = false;
const osdIntervalMs = 100;
let overlayTimer: number | undefined;
let data = '';

// Sync with options in webtorrent.node.ts
const options = {
  path: './',
  skipVerify: false,
  maxConns: 100,
  port: 8888,

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
};

mp.options.read_options(options, 'stats');
mp.options.read_options(options);

function keyPressHandler() {
  if (waiting) {
    active = true;
    waiting = false;
  }
  active = !active;
  if (active) {
    showOverlay();
  } else {
    clearOverlay();
  }
}

function showOverlay() {
  if (!waiting && !data) {
    return;
  }
  if (overlayTimer) {
    return;
  }
  printOverlay();
  overlayTimer = setInterval(printOverlay, osdIntervalMs) as unknown as number;
}

function printOverlay() {
  if (!data) {
    return;
  }
  mp.osd_message(assStart + data + assStop, osdIntervalMs * 2 / 1000);
}

function clearOverlay() {
  clearInterval(overlayTimer);
  overlayTimer = undefined;
  mp.osd_message('', 0);
}

function onData(_data: unknown) {
  data = _data as string;
}

function onInfo(..._info: unknown[]) {
  mp.msg.info(..._info as string[]);
}

function onFileLoaded() {
  waiting = false;
  if (!active) {
    clearOverlay();
  }

  orgIdle && mp.set_property('idle', orgIdle);
  orgForceWindow && mp.set_property('force-window', orgForceWindow);
}

function onLoadHook() {
  const url = mp.get_property('stream-open-filename', '');

  if (/^magnet:/i.test(url)) {
    runHook(url);
  } else if (/\.torrent$/i.test(url)) {
    runHook(url);
  } else if (/^[0-9A-F]{40}$/i.test(url)) {
    runHook(url);
  } else if (/^[0-9A-Z]{32}$/i.test(url)) {
    runHook(url);
  }
}

function runHook(url: string) {
  mp.msg.info('Running webtorrent hook');

  let socketName = mp.get_property('input-ipc-server');
  if (!socketName) {
    mp.set_property('input-ipc-server', `/tmp/webtorrent-mpv-hook-socket-${Date.now()}`);
    socketName = mp.get_property('input-ipc-server');
  }
   
  const realPath = mp.command_native({
    name: 'subprocess',
    args: ['node', '-p', `require('fs').realpathSync('${mp.get_script_file()}')`],
    playback_only: false,
    capture_stderr: true,
    capture_stdout: true
  }) as SubprocessResult | undefined;

  if (!realPath) {
    mp.msg.error(mp.last_error());
    return;
  } else if (realPath.stderr) {
    mp.msg.error(realPath.stderr);
    return;
  } else if (realPath.status) {
    mp.msg.error('node script failed');
    return;
  }

  const scriptName = realPath.stdout.split(/\r\n|\r|\n/)[0].replace(/webtorrent\.js$/, 'webtorrent.node.js');

  orgIdle = mp.get_property('idle');
  orgForceWindow = mp.get_property('force-window');
  mp.set_property('idle', 'yes');
  mp.set_property('force-window', 'yes');

  waiting = true;
  mp.register_script_message('osd-data', onData);
  mp.register_script_message('info', onInfo);
  mp.register_event('file-loaded', onFileLoaded);

  const args = {
    torrentId: url,
    socketName,
    ...options
  };

  mp.command_native_async({
    name: 'subprocess',
    args: ['node', scriptName, JSON.stringify(args)],
    playback_only: false,
    capture_stderr: true
  }, onExit);

  mp.add_key_binding('p', 'toggle-info', keyPressHandler);
  showOverlay();

  function onExit(success: boolean, _result: unknown) {
    const result = _result as SubprocessResult;
    if (!success) {
      mp.msg.error('Failed to start webtorrent');
    } else if (result.stderr) {
      mp.msg.error(result.stderr);
    } else if (result.status) {
      mp.msg.error('Webtorrent exited with error');
    }
    orgIdle && mp.set_property('idle', orgIdle);
    orgForceWindow && mp.set_property('force-window', orgForceWindow);
  }
}

mp.add_hook('on_load_fail', 50, onLoadHook);