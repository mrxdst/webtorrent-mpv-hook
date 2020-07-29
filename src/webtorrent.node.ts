import WebTorrent from 'webtorrent';
import net from 'net';
import convert from 'convert-units';
import { MpvJsonIpc } from 'mpv-json-ipc';

declare module 'webtorrent' {
  interface TorrentFile {
    offset: number; // Undocumented
  }

  interface TorrentOptions {
    skipVerify?: boolean; // Undocumented
  }
}
  
process.title = 'webtorrent-mpv-hook';

process.on('SIGINT', exit);
process.on('SIGTERM', exit);
process.on('uncaughtException', error);
process.on('unhandledRejection', error);

// Sync with options in webtorrent.ts
type Options = {
  torrentId: string;
  socketName: string;

  path: string;
  skipVerify: boolean;
  maxConns: number;
  port: number;

  // Text style. from stats.lua
  font: string;
  font_mono: string;
  font_size: number;
  font_color: string;
  border_size: number;
  border_color: string;
  shadow_x_offset: number;
  shadow_y_offset: number;
  shadow_color: string;
  alpha: string;
}

const options = JSON.parse(process.argv[2]) as Options;

const textStyle = [
  `{\\r}{\\an7}`,
  `{\\fs${Math.floor(options.font_size)}}`,
  `{\\fn${options.font}}`,
  `{\\bord${options.border_size}}`,
  `{\\3c&H${options.border_color}&}`,
  `{\\1c&H${options.font_color}&}`,
  `{\\alpha&H${options.alpha}&}`,
  `{\\xshad${options.shadow_x_offset}}`,
  `{\\yshad${options.shadow_y_offset}}`,
  `{\\4c&H${options.shadow_color}&}`
].join('');

let exiting = false;

let socket: net.Socket;
let jsonIpc: MpvJsonIpc;
let currentFile: string | undefined;

const assStart = '${osd-ass-cc/0}';
const assStop = '${osd-ass-cc/1}';

connectMpv();

const client = new WebTorrent({
  maxConns: options.maxConns
});
client.on('error', error);

const torrent = client.add(options.torrentId, {
  path: options.path,
  skipVerify: options.skipVerify
});

torrent.on('infoHash', () => log('Info hash:', torrent.infoHash));
torrent.on('metadata', () => log('Metadata downloaded'));

let server = torrent.createServer();
server.on('error', serverError);
server.listen(options.port);

function serverError(err: NodeJS.ErrnoException): void {
  if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
    server = torrent.createServer();
    server.on('error', error);
    server.listen(0);
    return;
  }

  return error(err);
}

function connectMpv(): void {
  socket = net.createConnection(options.socketName);
  socket.unref();

  jsonIpc = new MpvJsonIpc(socket);

  socket.on('connect', () => {
    sendOverlay();
    setInterval(sendOverlay, 500);
    if (torrent.ready) {
      startPlayback();
    } else {
      torrent.once('ready', startPlayback);
    }
  });

  jsonIpc.on('file-loaded', () => {
    void(getPath());
    async function getPath() {
      const res = await jsonIpc.command('get_property', 'path');
      currentFile = res.data as string | undefined;
      sendOverlay();
    }
  });

  jsonIpc.on('end-file', () => {
    currentFile = undefined;
    sendOverlay();
  });
}

function startPlayback(): void {
  log('Ready for playback');
  const port = (server?.address() as net.AddressInfo).port;
  
  const sortedFiles = [...torrent.files].sort((a, b) => a.path.localeCompare(b.path, undefined, {numeric: true}));

  const playlist = sortedFiles.map(file => {
    const index = torrent.files.indexOf(file);
    const item = `http://localhost:${port}/${index}/${encodeURIComponent(file.name)}`;
    return item;
  });

  void(jsonIpc.command('script-message-to', 'webtorrent', 'playlist', JSON.stringify(playlist)));
}

function sendOverlay(): void {
  const B = (text: string): string => '{\\b1}' + text + '{\\b0}';
  const raw = (text: string): string => assStop + text.replace(/\$/g, '$$$$') + assStart;

  const bar = buildProgressBar(torrent.pieces);
  const progress = Math.floor(torrent.progress * 1000) / 10;
  const downloaded = formatNumber(torrent.downloaded, 'B', 2);
  const uploaded = formatNumber(torrent.uploaded, 'B', 2);
  const size = formatNumber(torrent.length, 'B', 2);
  const timeRemaining = torrent.timeRemaining ? formatNumber(torrent.timeRemaining, 'ms', 1) : '';
  const download = formatNumber(torrent.downloadSpeed, 'B', 2) + '/s';
  const upload = formatNumber(torrent.uploadSpeed, 'B', 2) + '/s';
  const ratio = torrent.uploaded / torrent.downloaded;
  
  const lines = [
    `${B('Torrent:')}  ${raw(torrent.name ?? torrent.infoHash ?? '')}`,
    `  ${B('Progress:')}  ${bar}  ${progress === 100 ? progress : progress.toFixed(1)}%`,
    `  ${B('Downloaded:')}  ${downloaded.padEnd(10, '\u2003')}  ${B('Size:')}  ${size.padEnd(10, '\u2003')}  ${B('Uploaded:')}  ${uploaded}`,
    `  ${B('Download:')}  ${download.padEnd(10, '\u2003')}  ${B('Upload:')}  ${upload}`,
    `  ${B('Time remaining:')}  ${timeRemaining}`,
    `  ${B('Ratio:')}  ${(ratio || 0).toFixed(2)}`,
    `  ${B('Peers:')}  ${torrent.numPeers}`,
  ];
  
  if (currentFile) {
    const match = /http:\/\/localhost:\d+\/(\d+)/.exec(currentFile);
    if (match) {
      const file = torrent.files[parseInt(match[1])];
      if (file) {

        const startPiece = Math.floor(file.offset / torrent.pieceLength | 0);
        const endPiece = Math.ceil((file.offset + file.length - 1) / torrent.pieceLength | 0);

        const pieces = torrent.pieces.slice(startPiece, endPiece + 1);

        const _downloaded = Math.min(torrent.downloaded, file.downloaded);

        const bar = buildProgressBar(pieces);
        const progress = Math.floor(file.progress * 1000) / 10;
        const downloaded = formatNumber(_downloaded, 'B', 2);
        const size = formatNumber(file.length, 'B', 2);

        lines.push(...[
          '',
          `${B('File:')}  ${raw(file.name)}`,
          `  ${B('Progress:')}  ${bar}  ${progress === 100 ? progress : progress.toFixed(1)}%`,
          `  ${B('Downloaded:')}  ${downloaded.padEnd(10, '\u2003')}  ${B('Size:')}  ${size}`
        ]);
      }
    }
  }

  void(jsonIpc.command('script-message-to', 'webtorrent', 'osd-data', assStart + textStyle + lines.join('\n') + assStop));
}

type Unit = Parameters<ReturnType<typeof convert>['from']>[0];
function formatNumber(value: number, unit: Unit, fractionDigits = 0): string {
  value = value || 0;
  const res = convert(value).from(unit).toBest();

  return res.val.toFixed(fractionDigits) + ' ' + res.unit;
}

function buildProgressBar(pieces: typeof torrent.pieces): string {
  const fullBar = pieces.map(p => p ? 1 - (p.missing / p.length) : 1);

  const barSize = 50;
  
  let bar: number[] = [];

  const sumFn = (acc: number, cur: number): number => acc + cur;

  if (fullBar.length > barSize) {
    const interval = fullBar.length / barSize;
    for (let n = 0; n <= (fullBar.length - 1); n += interval) {
      const i =  Math.floor(n);
      const i2 = Math.floor(n + interval);
      const parts = fullBar.slice(i, i2);
      const sum = parts.reduce(sumFn, 0);
      bar.push(sum / parts.length);
    }
  } else {
    bar = fullBar;
  }

  const barText = bar.map(p => {
    if (p >= 1) {
      return '█';
    } else if (p >= 2 / 3) {
      return '▓';
    } else if (p >= 1 / 3) {
      return '▒';
    } else if (p > 0) {
      return '░';
    } else {
      return `{\\alpha&HCC&}{\\3a&HFF&}█{\\alpha&H${options.alpha}&}`;
    }
  }).join('');

  return `{\\fn${options.font_mono}}{\\fscy80}{\\fscx80}${barText}{\\fscy}{\\fscx}{\\fn${options.font}}`;
}

function log(...args: Parameters<typeof console.log>): void {
  void(jsonIpc.command('script-message-to', 'webtorrent', 'info', ...args));
}

function exit (): void {
  if (exiting) {
    return;
  }

  exiting = true;

  process.removeListener('SIGINT', exit);
  process.removeListener('SIGTERM', exit);

  server.close(() => {
    client.destroy(() => {
      process.exit(0);
    });
  });
}

function error (error: string | Error): void {
  if (typeof error === 'string') {
    error = new Error(error);
  }
  console.error(error.toString());
  process.exit(1);
}