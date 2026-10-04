<div align="center">

# multi-miner

Local stratum shim that adds C3Pool algorithm switching to miners that lack pool-side algo switching.

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.9.0-brightgreen.svg" alt="Node >=22.9.0">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/focus-multi--algo%20miner%20manager-2da44e.svg" alt="Focus">
  <a href="https://c3pool.com"><img src="https://img.shields.io/badge/C3Pool-mining%20pool-6f42c1.svg" alt="C3Pool"></a>
</p>

</div>

## Overview

Multi-Miner adds C3Pool algorithm switching support to stratum
miners that do not implement pool-side algo switching themselves. It runs a
local stratum endpoint for your miner, connects to one or more upstream pools,
and starts the configured miner command for each algorithm requested by the
pool.

Multi-Miner does not add a mining fee. The project remains GPLv3.

Multi-Miner sits between your miner and the [C3Pool](https://c3pool.com) pool:
the pool announces which algorithm to mine, and Multi-Miner swaps the active
miner command to match.

## 中文快速上手

Multi-Miner 是一个本地 stratum 中转：矿机连本机 `127.0.0.1:3333`，Multi-Miner
连 C3Pool，并按矿池下发的算法自动切换到对应的挖矿程序（CPU 与显卡程序可混用）。

1. 从 [Releases](https://github.com/C3Pool/meta-miner/releases) 下载对应平台的压缩包，解压到挖矿程序旁边。
2. 每个挖矿程序都配置为连接 `127.0.0.1:3333`（不要直连矿池、不要开 TLS）。
3. 启动，例如 XMRig 跑 CPU + SRBMiner 跑显卡 `kawpow` / `etchash` / `autolykos2`：

```sh
./mm -p=auto.c3pool.org:ssl33333 -u=你的钱包地址 --pass=矿机名 \
  -m="./xmrig -o 127.0.0.1:3333 -u 你的钱包地址 -p x" \
  --kawpow="./SRBMiner-MULTI --algorithm kawpow --pool 127.0.0.1:3333 --wallet 你的钱包地址 --password x --disable-cpu" \
  --etchash="./SRBMiner-MULTI --algorithm etchash --pool 127.0.0.1:3333 --wallet 你的钱包地址 --password x --disable-cpu" \
  --autolykos2="./SRBMiner-MULTI --algorithm autolykos2 --pool 127.0.0.1:3333 --wallet 你的钱包地址 --password x --disable-cpu"
```

首次运行会对每个算法做一次本地基准测试并写入 `mm.json`，之后直接 `./mm` 即可启动。
矿池地址：TLS `auto.c3pool.org:ssl33333`（推荐）、TCP `auto.c3pool.org:19999`。

## Features

- Local stratum endpoint (default `127.0.0.1:3333`) that any miner can point at.
- Per-algorithm miner commands, switched automatically as the pool requests them.
- Support for "smart" miners that report their own supported algorithms (`--miner`).
- Multiple upstream pools, with additional `--pool` entries acting as backups.
- TLS to the upstream pool via `sslPORT` / `tlsPORT` while keeping the local link plaintext.
- Built-in benchmarking against a local fake job to populate `algo_perf`.
- Hashrate parsing for XMRig, xmr-stak, SRBMiner-Multi, lolMiner, GMiner, Rigel,
  T-Rex, TeamRedMiner, Team Black Miner, CryptoDredge, Claymore, and legacy formats.
- Watchdog and hashrate-watchdog restarts for stalled miners.
- Config validation via `--diagnostics`, with no external pool contact required.

## Quick Start

Release binaries are OS and CPU architecture specific:

| Platform | Binary |
| --- | --- |
| Windows x64 | `mm.exe` |
| Linux x64 | `mm` |
| Linux arm64 | `mm` |
| macOS Intel x64 | `mm` |
| macOS arm64 | `mm` |

Download the archive for your platform from
[Releases](https://github.com/C3Pool/meta-miner/releases), unpack it beside your miner, and point
the miner at Multi-Miner's local pool, usually `127.0.0.1:3333`.

Windows:

```powershell
.\mm.exe -p=auto.c3pool.org:ssl33333 -u=YOUR_XMR_WALLET --pass=x --rx/0="xmrig.exe --config=config.json"
```

Linux and macOS:

```sh
./mm -p=auto.c3pool.org:ssl33333 -u=YOUR_XMR_WALLET --pass=x --rx/0="./xmrig --config=config.json"
```

Source compatibility is kept. You can still run `mm.js` directly:

```sh
node mm.js -p=auto.c3pool.org:ssl33333 -u=YOUR_XMR_WALLET --pass=x --rx/0="./xmrig --config=config.json"
```

## Configuration

Multi-Miner keeps the historical `mm.json` config format and all existing CLI
option names. If no command line options are supplied, `mm.json` in the current
directory is loaded.

Minimal `mm.json`:

```json
{
  "miner_host": "127.0.0.1",
  "miner_port": 3333,
  "pools": ["auto.c3pool.org:ssl33333"],
  "algos": {
    "rx/0": "./xmrig --config=config.json",
    "cn/gpu": "./SRBMiner-MULTI --algorithm cryptonight_gpu --pool 127.0.0.1:3333 --wallet YOUR_XMR_WALLET --password x --disable-cpu",
    "etchash": "./SRBMiner-MULTI --algorithm etchash --pool 127.0.0.1:3333 --wallet YOUR_XMR_WALLET --password x --disable-cpu"
  },
  "algo_perf": {
    "rx/0": 1000,
    "cn/gpu": 1000,
    "etchash": 50000000
  },
  "user": "YOUR_XMR_WALLET",
  "pass": "x",
  "watchdog": 600,
  "hashrate_watchdog": 0
}
```

Useful options:

| Option | Description |
| --- | --- |
| `--pool=<host:port>` (`-p`) | Adds a pool. Use `sslPORT` or `tlsPORT` for TLS. |
| `--host=<hostname>` | Local miner bind host. Default: `127.0.0.1`. |
| `--port=<number>` | Local miner bind port. Default: `3333`. |
| `--user=<wallet>` (`-u`) | Pool login. Uses first miner login if omitted. |
| `--pass=<worker>` | Pool password/worker. Uses first miner pass if omitted. |
| `--miner=<command>` (`-m`) | Smart miner that reports supported algorithms. |
| `--<algo>=<command>` | Miner command for one algorithm. |
| `--perf_<algo>=<hashrate>` | Expected hashrate; use `0` to benchmark again. |
| `--algo_min_time=<seconds>` | Minimum time pool should keep one algorithm. |
| `--watchdog=<seconds>` (`-w`) | Restart miner after no submits; `0` disables. |
| `--hashrate_watchdog=<percent>` | Restart if reported hashrate drops below threshold. |
| `--miner_stdin` | Inherit stdin for miner processes. |
| `--diagnostics` | Validate config and exit. |
| `--quiet` (`-q`), `--verbose` (`-v`), `--debug` | Logging verbosity. |
| `--log=<file>`, `--no-config-save`, `--help` | Log file, skip config save, usage. |

Current C3Pool GPU algorithms covered by Multi-Miner metadata include
`autolykos2`, `c29`, `cn/gpu`, `etchash`, `kawpow`, and `pearlhash`.
Existing `algo_perf.kawpow` values keep their legacy units and are reported unchanged. New
benchmarks and `--perf_kawpow` values are stored as `algo_perf.kawpow1` in raw H/s.

## C3Pool Examples

C3Pool endpoints for Multi-Miner:

| Endpoint | Transport |
| --- | --- |
| `auto.c3pool.org:ssl33333` | TLS (recommended) |
| `auto.c3pool.org:19999` | Plain TCP |
| `auto.c3pool.org:443`, `auto.c3pool.org:80` | Plain TCP on firewall-friendly ports |

The TLS port serves a self-signed certificate, so leave `tls_reject_unauthorized`
at its default `false`.
Miner commands should still connect to Multi-Miner locally without TLS at
`127.0.0.1:3333`.

These examples keep only the options needed for Multi-Miner and C3Pool
compatibility. Add device selection, clocks, logging, API, or tuning options in
your miner config when needed for your rig.

### Through Multi-Miner

XMRig smart miner:

```sh
./mm -p=auto.c3pool.org:ssl33333 -u=YOUR_XMR_WALLET --pass=x \
  -m="./xmrig -o 127.0.0.1:3333 -u YOUR_XMR_WALLET -p x"
```

SRBMiner-Multi for `cn/gpu`:

```sh
./mm -p=auto.c3pool.org:ssl33333 -u=YOUR_XMR_WALLET --pass=x \
  --perf_cn/gpu=1000 \
  --cn/gpu="./SRBMiner-MULTI --algorithm cryptonight_gpu --pool 127.0.0.1:3333 --wallet YOUR_XMR_WALLET --password x --disable-cpu"
```

SRBMiner-Multi for `autolykos2`, `etchash`, and `kawpow`:

```sh
./mm -p=auto.c3pool.org:ssl33333 -u=YOUR_XMR_WALLET --pass=x \
  --perf_autolykos2=100000000 --perf_etchash=50000000 --perf_kawpow=50000000 \
  --autolykos2="./SRBMiner-MULTI --algorithm autolykos2 --pool 127.0.0.1:3333 --wallet YOUR_XMR_WALLET --password x --disable-cpu" \
  --etchash="./SRBMiner-MULTI --algorithm etchash --pool 127.0.0.1:3333 --wallet YOUR_XMR_WALLET --password x --disable-cpu" \
  --kawpow="./SRBMiner-MULTI --algorithm kawpow --pool 127.0.0.1:3333 --wallet YOUR_XMR_WALLET --password x --disable-cpu"
```

BZMiner for `pearlhash`:

```sh
./mm -p=auto.c3pool.org:ssl33333 -u=YOUR_XMR_WALLET --pass=x \
  --pearlhash="./bzminer -a pearl -p stratum+tcp://127.0.0.1:3333 -w YOUR_XMR_WALLET --pass x --worker multi-miner --nvidia"
```

SRBMiner-Multi for `pearlhash`:

```sh
./mm -p=auto.c3pool.org:ssl33333 -u=YOUR_XMR_WALLET --pass=x \
  --pearlhash="./SRBMiner-MULTI --algorithm pearlhash --pool 127.0.0.1:3333 --wallet YOUR_XMR_WALLET --password x --disable-cpu"
```

When a Pearl pool advertises gzip support, Multi-Miner passes that capability
to the miner and compresses an uncompressed proof when that reduces its size.
If gzip would be larger, the original proof is forwarded; proofs already encoded
by the miner are also forwarded unchanged.

For SRBMiner Etchash `--esm 0`, Multi-Miner accepts the initial `eth_getWork`
request and forwards pushed getWork-style job refreshes from the pool, so stale
`block expired` loops are not hidden behind the local proxy.

lolMiner for `autolykos2`, `etchash`, and `c29`:

```sh
./mm -p=auto.c3pool.org:ssl33333 -u=YOUR_XMR_WALLET --pass=x \
  --perf_autolykos2=100000000 --perf_etchash=50000000 --perf_c29=1 \
  --autolykos2="./lolMiner --algo AUTOLYKOS2 --pool 127.0.0.1:3333 --user YOUR_XMR_WALLET --pass x" \
  --etchash="./lolMiner --algo ETCHASH --pool 127.0.0.1:3333 --user YOUR_XMR_WALLET --pass x" \
  --c29="./lolMiner --algo CR29 --pool 127.0.0.1:3333 --user YOUR_XMR_WALLET --pass x"
```

GMiner for `autolykos2`, `etchash`, and `kawpow`:

```sh
./mm -p=auto.c3pool.org:ssl33333 -u=YOUR_XMR_WALLET --pass=x \
  --perf_autolykos2=100000000 --perf_etchash=50000000 --perf_kawpow=50000000 \
  --autolykos2="./miner --algo autolykos2 --server 127.0.0.1 --port 3333 --user YOUR_XMR_WALLET --pass x --proto stratum" \
  --etchash="./miner --algo etchash --server 127.0.0.1 --port 3333 --user YOUR_XMR_WALLET --pass x --proto stratum" \
  --kawpow="./miner --algo kawpow --server 127.0.0.1 --port 3333 --user YOUR_XMR_WALLET --pass x --proto stratum"
```

Rigel for `autolykos2`, `etchash`, and `kawpow`:

```sh
./mm -p=auto.c3pool.org:ssl33333 -u=YOUR_XMR_WALLET --pass=x \
  --perf_autolykos2=100000000 --perf_etchash=50000000 --perf_kawpow=50000000 \
  --autolykos2="./rigel -a autolykos2 -o stratum+tcp://127.0.0.1:3333 -u YOUR_XMR_WALLET -p x" \
  --etchash="./rigel -a etchash -o stratum+tcp://127.0.0.1:3333 -u YOUR_XMR_WALLET -p x" \
  --kawpow="./rigel -a kawpow -o stratum+tcp://127.0.0.1:3333 -u YOUR_XMR_WALLET -p x"
```

T-Rex for `autolykos2`, `etchash`, and `kawpow`:

```sh
./mm -p=auto.c3pool.org:ssl33333 -u=YOUR_XMR_WALLET --pass=x \
  --perf_autolykos2=100000000 --perf_etchash=50000000 --perf_kawpow=50000000 \
  --autolykos2="./t-rex -a autolykos2 -o stratum+tcp://127.0.0.1:3333 -u YOUR_XMR_WALLET -p x" \
  --etchash="./t-rex -a etchash -o stratum+tcp://127.0.0.1:3333 -u YOUR_XMR_WALLET -p x" \
  --kawpow="./t-rex -a kawpow -o stratum+tcp://127.0.0.1:3333 -u YOUR_XMR_WALLET -p x"
```

### Direct To C3Pool

Direct miner commands are a reference for checking miner and C3Pool pool
compatibility. They pin the miner to one algorithm, show the miner-specific TLS
or stratum mode syntax, and pass the fixed algorithm in the password as
`WORKER~algo`. Use Multi-Miner when you want C3Pool to switch between
different miner commands.

In most cases, start from the Multi-Miner example and replace Multi-Miner's
local `127.0.0.1:3333` pool with the direct C3Pool TLS endpoint. The
useful differences are the pool URL syntax and any miner-specific protocol
mode:

```sh
XMRig:          -o auto.c3pool.org:33333 --tls -p worker~rx/0
SRBMiner-Multi: --pool auto.c3pool.org:33333 --tls true --password worker~cn/gpu
GMiner:         --server auto.c3pool.org --port 33333 --ssl 1 --pass worker~etchash --proto stratum
lolMiner:       --pool auto.c3pool.org:33333 --tls on --pass worker~etchash --ethstratum ETHV1
T-Rex:          -o stratum2+ssl://auto.c3pool.org:33333 -p worker~kawpow --no-strict-ssl
Rigel:          -o stratum+ssl://auto.c3pool.org:33333 -p worker~kawpow --no-strict-ssl
BZMiner:        -a pearl -p stratum+ssl://auto.c3pool.org:33333 --pass worker~pearl --nvidia
```

Upstream testing found that lolMiner Etchash works with both
`--ethstratum ETHV1` and `--ethstratum ETHPROXY`, and SRBMiner-Multi Etchash
accepts shares with `--esm 0`, `--esm 1`, and `--esm 2`.

## Benchmarking And Hashrate

If `algo_perf` is missing or set to `0` for a configured benchmark algorithm,
Multi-Miner starts the miner against a local fake job and reads hashrate from
miner output. Hashrate parsing includes common formats from XMRig, xmr-stak,
SRBMiner-Multi, BZMiner, lolMiner, GMiner, Rigel, T-Rex, TeamRedMiner, Team Black Miner,
CryptoDredge, Claymore, and legacy formats.

For specific re-benchmarking:

```sh
./mm --perf_rx/0=0 --perf_cn/gpu=0
```

## Diagnostics

Validate a config without connecting to an external pool:

```sh
./mm mm.json --diagnostics
node mm.js mm.json --diagnostics
```

Common checks:

```sh
./mm --help
./mm mm.json --verbose --debug
```

Troubleshooting notes:

- Configure every miner to connect to Multi-Miner, not directly to the remote pool.
- Use a unique `--port` for each Multi-Miner instance on the same host.
- Keep quotes around miner commands that contain spaces.
- Use backup pools by specifying `--pool` more than once.
- Set `--watchdog=0` while debugging miner startup.
- Use `--no-config-save` for temporary CLI-only test runs.

## Development

Requirements:

- Node.js 22.9.0 or newer (npm 11.10.0 or newer) for source usage and tests.
- Network access only for installing build tooling or contacting real pools.

Install the development dependencies without creating a lockfile:

```sh
npm install --no-package-lock
```

Build the current platform binary:

```sh
npm run build:current
```

Build all release targets:

```sh
npm run build:release
```

The release workflow publishes clean per-platform archives containing only the
binary, `README.md`, `LICENSE`, and user documentation files. Source, tests,
CI metadata, caches, and development artifacts are excluded from release
archives.

## Testing

Run the unit test suite, quality checks, and dependency audit:

```sh
npm test
npm run quality
npm run audit
```

Run all optional local live tests. These use fake localhost pools only and
skip unavailable hardware. Missing supported miner distributions are downloaded
into this repo's `.cache/live-miners` cache before the cases run. Every runnable
case waits for a real share submit to the fake pool. C29 can take several
minutes even at the lowest fake difficulty; override `MM_LIVE_C29_TIMEOUT_MS`
if needed:

```sh
npm run test:live
```

Set `MM_LIVE_DOWNLOAD=0` to disable live miner downloads and only use binaries
already present in the local cache or specified by path overrides.

Run the optional CPU live test. It uses only a fake localhost pool and downloads
the MoneroOcean XMRig fork into the local live cache when needed:

```sh
npm run test:live:cpu
XMRIG_PATH=/path/to/xmrig MM_LIVE_CPU_CASES=xmrig-rx-0,xmrig-panthera npm run test:live:cpu
```

Run the optional local Intel GPU live test. It uses only a fake localhost pool
and skips if SRBMiner, mom, an algorithm, or an Intel OpenCL GPU is unavailable.
SRBMiner-Multi and mom are downloaded into this repo's `.cache/live-miners`
cache when needed. Override with `MM_LIVE_CACHE_DIR` or a miner-specific path:

```sh
npm run test:live:intel-gpu
SRBMINER_PATH=/path/to/SRBMiner-MULTI npm run test:live:intel-gpu
MOM_PATH=/path/to/mom MM_LIVE_MOM_C29_DEVICE=gpu1*1 npm run test:live:intel-gpu
MM_LIVE_INTEL_GPU_CASES=srbminer-cn-gpu,mom-c29 npm run test:live:intel-gpu
```

Run the optional NVIDIA GPU miner matrix. It also uses fake localhost pools only
and downloads supported miner distributions into this repo's `.cache/live-miners`
cache when needed. Each passed case prints the miner protocol Multi-Miner observed
(`default`, `eth`, `ethproxy`, or `grin`) so ETH-proxy and non-ETH-proxy modes
are checked explicitly:

```sh
MM_LIVE_MINER_ROOT=/path/to/miners npm run test:live:nvidia-gpu
MM_LIVE_NVIDIA_GPU_MINERS=trex-etchash,rigel-kawpow npm run test:live:nvidia-gpu
MM_LIVE_NVIDIA_GPU_MINERS=srbminer-etchash,srbminer-etchash-ethstratum2,srbminer-etchash-ethproxy,trex-etchash,trex-etchash-stratum2 npm run test:live:nvidia-gpu
MM_LIVE_NVIDIA_GPU_MINERS=srbminer-pearlhash,bzminer-pearlhash npm run test:live:nvidia-gpu
```

The NVIDIA `xmrig-cuda-rx-0` live case needs the MoneroOcean XMRig fork and the
MoneroOcean `xmrig-cuda` plugin. Put them under the live miner cache as
`xmrig-mo/.../xmrig` and `xmrig-cuda/.../libxmrig-cuda.so`, or point
`MM_LIVE_MINER_ROOT` at a directory with that layout. The CUDA plugin must be
built for the installed NVIDIA driver/GPU and must be able to load its CUDA
runtime dependencies; either install the matching CUDA runtime system-wide or
place libraries such as `libnvrtc.so.*` beside `libxmrig-cuda.so`.

## Upstream

This repository is C3Pool's fork of
[MoneroOcean/multi-miner](https://github.com/MoneroOcean/multi-miner). The
miner logic follows upstream; C3Pool changes are limited to branding, pool
endpoints, and documentation. To pull in upstream changes:

```sh
git remote add upstream https://github.com/MoneroOcean/multi-miner.git
git fetch upstream
git merge upstream/master
```

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
