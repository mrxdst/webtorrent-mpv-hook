![mpv streaming a torrent](https://github.com/mrxdst/webtorrent-mpv-hook/raw/master/.github/poster.png)

# webtorrent-mpv-hook
[![npm](https://img.shields.io/npm/v/webtorrent-mpv-hook)](https://www.npmjs.com/package/webtorrent-mpv-hook)
[![mpv](https://img.shields.io/badge/mpv-v0.33.0-blue)](https://mpv.io/)

Adds a hook that allows mpv to stream torrents using [webtorrent](https://github.com/webtorrent/webtorrent).  

## Install

1. `npm install --global webtorrent-mpv-hook`
2. You need to symlink a script file to your mpv scripts folder.  
   Run `webtorrent-mpv-hook` for instructions.  
   You only need to do this once.

## Usage

`mpv <torrent-id>`

Where `torrent-id` is one of:
* magnet link
* info-hash
* path or url to `.torrent` file

An overlay will be shown with info/progress. It will be closed automatically when playback starts.  
It can also be toggled manually with `p` (default).

> Multi-file torrents are opened as a playlist.

## Configuration

Default values are shown below.

### `input.conf`

```properties
# Toggles info/progress overlay.
p script-binding webtorrent/toggle-info
```

### `script-opts/webtorrent.conf`
```properties
# Path to save downloaded files in.
path=./
# Maximum number of connections.
maxConns=100
# Port to use for webtorrent web-server.
# If it's already in use a random port will be chosen instead.
port=8888
# Enable μTP support.
utp=no
# Enable DHT.
dht=yes
```
