# meta-miner
Meta Miner: allows to add algo switching support to *any* stratum miner.

Does not add any extra mining fees.

## Check mm.js builtin help

```
Usage: mm.js [<config_file.json>] [options]
Adding algo switching support to *any* stratum miner
<config_file.json> is file name of config file to load before parsing options (mm.json by default)
Config file and options should define at least one pool and miner:
Options:
        --pool=<pool> (-p):             <pool> is in pool_address:pool_port format, where pool_port can be <port_number> or ssl<port_number>
        --host=<hostname>:              defines host that will be used for miner connections (localhost 127.0.0.1 by default)
        --port=<number>:                defines port that will be used for miner connections (3333 by default)
        --user=<wallet> (-u):           <wallet> to use as pool user login (will be taken from the first miner otherwise)
        --pass=<miner_id>:              <miner_id> to use as pool pass login (will be taken from the first miner otherwise)
        --perf_<algo>=<hashrate>        Sets hashrate for algo that is: rx/0, rx/wow, defyx, cn/r, cn-pico/trtl, cn-heavy/xhv, cn/gpu, argon2/chukwa, k12, c29s, c29v
        --algo_min_time=<seconds>       Sets <seconds> minimum time pool should keep our miner on one algo (0 default, set higher for starting miners)
        --miner=<command_line> (-m):    <command_line> to start smart miner that can report algo itself
        --<algo>=<command_line>:        <command_line> to start miner for <algo> that can not report it itself
        --watchdog=<seconds> (-w):      restart miner if is does not submit work for <seconds> (600 by default, 0 to disable)
        --hashrate_watchdog=<percent>:  restart miner if is hashrate dropped below <percent> value of of its expected hashrate (0 by default to disable)
        --miner_stdin:                  enables stdin (input) in miner
        --quiet (-q):                   do not show miner output during configuration and also less messages
        --verbose (-v):                 show more messages
        --debug:                        show pool and miner messages
        --log=<file_name>:              <file_name> of output log
        --no-config-save:               Do not save config file
        --help (-help,-h,-?):           Prints this help text
```

Check https://github.com/xmrig/xmrig-proxy/blob/master/doc/STRATUM_EXT.md#14-algorithm-names-and-variants for list of possible algo names.

## Sample mm.json (to use with xmrig v2.99.0+ located in the same directory)

```
{
 "miner_host": "127.0.0.1",
 "miner_port": 3333,
 "pools": [
  "mine.c3pool.com:13333"
 ],
 "algos": {
  "cn/1": "./xmrig --config=config.json",
  "cn/2": "./xmrig --config=config.json",
  "cn/r": "./xmrig --config=config.json",
  "cn/fast": "./xmrig --config=config.json",
  "cn/half": "./xmrig --config=config.json",
  "cn/xao": "./xmrig --config=config.json",
  "cn/rto": "./xmrig --config=config.json",
  "cn/rwz": "./xmrig --config=config.json",
  "cn/zls": "./xmrig --config=config.json",
  "cn/double": "./xmrig --config=config.json",
  "cn/gpu": "./xmrig --config=config.json",
  "cn-heavy/0": "./xmrig --config=config.json",
  "cn-heavy/tube": "./xmrig --config=config.json",
  "cn-heavy/xhv": "./xmrig --config=config.json",
  "cn-pico": "./xmrig --config=config.json",
  "rx/0": "./xmrig --config=config.json",
  "rx/wow": "./xmrig --config=config.json",
  "rx/loki": "./xmrig --config=config.json",
  "rx/arq": "./xmrig --config=config.json",
  "rx/sfx": "./xmrig --config=config.json",
  "rx/v": "./xmrig --config=config.json",
  "argon2/chukwa": "./xmrig --config=config.json",
  "argon2/wrkz": "./xmrig --config=config.json",
  "c29b": "./tube4referenceMiner/tube4referenceMinerCLI mode=rolling",
  "c29s": "./SwapReferenceMiner/SwapReferenceMinerCLI mode=rolling",
  "c29v": "./MoneroVMiner/bin/MoneroVMiner"
 },
 "algo_perf": {
  "rx/0": 243.6,
  "cn/r": 49.8,
  "cn/gpu": 12.9,
  "cn-heavy/xhv": 30.5,
  "cn-pico/trtl": 0,
  "rx/wow": 282.2,
  "defyx": 0,
  "argon2/chukwa": 4725.4,
  "k12": 0,
  "c29s": 0,
  "c29v": 0,
  "rx/loki": 243.6,
  "rx/v": 243.6,
  "cn/0": 49.8,
  "cn/1": 49.8,
  "cn/2": 49.8,
  "cn/wow": 49.8,
  "cn/fast": 99.6,
  "cn/half": 99.6,
  "cn/xao": 49.8,
  "cn/rto": 49.8,
  "cn/rwz": 66.39999999999999,
  "cn/zls": 66.39999999999999,
  "cn/double": 24.9,
  "cn-heavy/0": 30.5,
  "cn-heavy/tube": 30.5,
  "c29b": 0.07,
  "c29s": 0.0953125,
  "c29v": 0.25125
 },
 "algo_min_time": 0,
 "user": "43987ATFjfFXp9yBojQoifVPK4CerTF7Zaoo4eDY2p6AEp5uewT3PsY7hYHEHvbRivKcexmSaDdXscnnNtveV56pJpCa9uV",
 "pass": "x",
 "log_file": null,
 "watchdog": 600,
 "hashrate_watchdog": 0
}
```

## General configuration guidelines

* Configure your miners to connect to the single localhost:3333 (non SSL/TLS) pool.

* For best results separate xmr-stak/xmrig CPU and GPU miners (by using --noCPU, --noAMD, --noNVIDIA options for xmr-stak).

* Prepare your miner config files that give the best performance for your hardware on cryptonight, cryptonight-heavy, cryptonight-pico, randomx, randomx/wow, randomx/arq algorithm classes (not needed for xmrig v2.99+).

* If you have several miners on one host use mm.js --port option to assign them to different ports.

* Additional mm.js pools will be used as backup pools.

* To rerun benchmark for specific algorithm class use --perf_*algo*=0 option.

The configuration guide below is for stock xmrig. For xmr-stak/rx check [configuration guide for xmr-stak](xmr-stak.md).
For c29 algo check [configuration guide for cuckaroo29](c29.md).

## Usage examples on Windows

Place mm.exe or mm.js (with nodejs installed) into unpacked miner directory either by:

* Download and unpack the latest mm-vX.X.zip from https://github.com/C3Pool/meta-miner/releases

* Download and install nodejs using https://nodejs.org/dist/v8.11.3/node-v8.11.3-x64.msi installator and download and unpack https://raw.githubusercontent.com/C3Pool/meta-miner/master/mm.js

### Usage example with xmrig on Windows

* Download and unpack the lastest xmrig-amd (https://github.com/xmrig/xmrig/releases/download/v5.4.0/xmrig-5.4.0-msvc-win64.zip).

* Modify config.json file in xmrig directory this way and adjust it for the best threads performance (out of scope of this guide):

	* Set "url" to "localhost:3333"
	* Set "user" to "43987ATFjfFXp9yBojQoifVPK4CerTF7Zaoo4eDY2p6AEp5uewT3PsY7hYHEHvbRivKcexmSaDdXscnnNtveV56pJpCa9uV" (put your Monero wallet address)

* Run Meta Miner (or use "node mm.js" instead of mm.exe):

```shell
mm.exe -p=mine.c3pool.com:13333 -m="xmrig-amd.exe --config=config.json"
```

## Usage examples on Linux (Ubuntu 18.04)

Get node and Meta Miner (mm.js) in the miner directory:

```shell
sudo apt-get update
sudo apt-get install -y nodejs
wget https://raw.githubusercontent.com/C3Pool/meta-miner/master/mm.js
chmod +x mm.js
```

### Usage example with xmrig on Linux

* Get xmrig:

```shell
wget https://github.com/xmrig/xmrig/releases/download/v5.4.0/xmrig-5.4.0-xenial-x64.tar.gz
tar xf xmrig-5.4.0-xenial-x64.tar.gz
cd xmrig-5.4.0
```

* Prepare configs for different algorithms (put your Monero wallet address):

```shell
sed -i 's/"url": *"[^"]*",/"url": "localhost:3333",/' config.json
sed -i 's/"user": *"[^"]*",/"user": "43987ATFjfFXp9yBojQoifVPK4CerTF7Zaoo4eDY2p6AEp5uewT3PsY7hYHEHvbRivKcexmSaDdXscnnNtveV56pJpCa9uV",/' config.json
```

* Run Meta Miner:

```shell
./mm.js -p=mine.c3pool.com:13333 -m="./xmrig --config=config.json"
```

## Developer Donations

If you'd like to make a one time donation, the addresses are as follows:

* XMR - ```43987ATFjfFXp9yBojQoifVPK4CerTF7Zaoo4eDY2p6AEp5uewT3PsY7hYHEHvbRivKcexmSaDdXscnnNtveV56pJpCa9uV```
* BTC - ```3Q4QT5WKMzCh4WqsGF2nKxc8XoLuLLuMqk```

