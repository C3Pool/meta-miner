"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it } = require("node:test");

const { createDefaultConfig } = require("../src/config");
const { formatDiagnostics, validateConfig } = require("../src/diagnostics");
const { detectMinerProtocol, ethProxySubmit, ethProxyWork, isEthProxyWorkResult } = require("../src/protocol");
const { MultiMinerApp } = require("../mm");
const { ethNotifyParams, silentLogger } = require("./common/helpers");

describe("protocol and diagnostics", () => {
  it("detects protocols without missing-field crashes", () => {
    assert.equal(detectMinerProtocol({ method: "login", params: {} }), "default");
    assert.equal(detectMinerProtocol({ method: "mining.authorize", params: [] }), "eth");
    assert.equal(detectMinerProtocol({ method: "eth_submitLogin", params: [] }), "ethproxy");
    assert.equal(detectMinerProtocol({ id: "Stratum", method: "login" }), "grin");
  });

  it("converts ethash notify payloads to ETH proxy work", () => {
    assert.deepEqual(ethProxyWork(ethNotifyParams(), null), [
      "0xfeb4243b885cd1af5337979f5d81849335cab197b4993e5c61ea4b43b43dbbc6",
      "0xe79f0f63030bf691445c2b9d0266b24a9619e355194067f2ad2c73a8e0a26c65",
      "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    ]);
  });

  it("scales the ethproxy boundary by the eth-stratum 2^32 factor (#7)", () => {
    const work = ethProxyWork(ethNotifyParams(), { jsonrpc: "2.0", method: "mining.set_difficulty", params: [2] });
    const boundary = BigInt(work[2]);
    const scale = 1000000n;
    const scaled = BigInt(Math.floor(2 * Number(scale)));
    const expected = ((1n << 256n) * scale) / (scaled << 32n); // 2^256/(d*2^32)
    assert.equal(boundary, expected, "boundary must be 2^256/(d*2^32), not the 2^32-too-loose 2^256/d");
    assert.ok(boundary < (1n << 256n) / 2n, "scaled boundary is far below the old unscaled value");
  });

  it("detects pushed ETH proxy work result frames", () => {
    assert.equal(isEthProxyWorkResult({ id: 0, jsonrpc: "2.0", result: ["0xaa", "0xbb", "0xcc"], algo: "etchash" }), true);
    assert.equal(isEthProxyWorkResult({ id: 0, jsonrpc: "2.0", result: ["0xaa", "0xbb", "0xcc", "0x123"], algo: "etchash" }), true);
    assert.equal(isEthProxyWorkResult({ method: "mining.notify", params: [] }), false);
  });

  it("maps ETH proxy submits to the polled work header", () => {
    const app = ethProxyApp("mm-ethproxy-");
    const poolWrites = [];
    const minerWrites = [];
    app.currPoolSocket = jsonSink(poolWrites);

    app.sendFirstJob({ id: 2, jsonrpc: "2.0", method: "eth_getWork", params: [] }, jsonSink(minerWrites));
    const header = minerWrites[0].result[0];
    app.currPoolLastJob = ethNotifyParams("job2");
    app.handleEthProxySubmit({ id: 3, jsonrpc: "2.0", method: "eth_submitWork", params: ["0x00", header, "0x11"] }, { write() {} });

    assert.equal(poolWrites.length, 1);
    assert.equal(poolWrites[0].method, "mining.submit");
    assert.equal(poolWrites[0].params[1], "job1");
  });

  it("preserves an optional final hash on translated ETH proxy submits", () => {
    const submit = ethProxySubmit({ id: 3, params: ["0x00", "0xheader", "0xmix"], result: "a".repeat(64) }, "wallet", ["job1"]);
    assert.equal(submit.result, "a".repeat(64));
    assert.deepEqual(submit.params, ["wallet", "job1", "0x00", "0xheader", "0xmix"]);
  });

  it("sends object jobs as standard job pushes for subscribe/authorize miners", () => {
    const app = ethProxyApp("mm-eth-standard-");
    const minerWrites = [];
    app.minerServer.protocol = "eth";
    app.currPoolLastJob = {
      algo: "ghostrider",
      blob: "00",
      job_id: "job1",
      target: "ffffffff",
    };

    app.sendFirstJob({ id: 2, jsonrpc: "2.0", method: "mining.authorize", params: ["wallet", "x"] }, jsonSink(minerWrites));

    assert.deepEqual(minerWrites[0], { jsonrpc: "2.0", method: "job", params: app.currPoolLastJob });
  });

  it("carries pool login nonce metadata into a cached object login reply", () => {
    const app = ethProxyApp("mm-object-metadata-");
    const minerWrites = [];
    app.minerServer.protocol = "default";
    app.currPoolLoginResult = {
      id: "pool-miner",
      status: "OK",
      extensions: ["mo-native"],
      extra_nonce: "abcd",
      extra_nonce2_size: 4,
    };
    app.currPoolLastJob = { algo: "rx/0", blob: "00", job_id: "job1", target: "ffffffff" };

    app.sendFirstJob({ id: 2, method: "login" }, jsonSink(minerWrites));

    assert.deepEqual(minerWrites[0].result.extensions, ["mo-native"]);
    assert.equal(minerWrites[0].result.extra_nonce, "abcd");
    assert.equal(minerWrites[0].result.extra_nonce2_size, 4);
  });

  it("uses current native nonce metadata and keeps the array job inside notify", () => {
    const app = ethProxyApp("mm-native-object-login-");
    const minerWrites = [];
    app.minerServer.protocol = "default";
    app.currPoolMinerId = "pool-miner";
    app.currAlgo = "kawpow";
    app.currPoolJobAlgo = "kawpow";
    app.currPoolLoginResult = {
      id: "pool-miner",
      extensions: ["mo-native"],
      extra_nonce: "old-prefix",
      extra_nonce2_size: 4,
    };
    app.currPoolLastExtraNonce = { jsonrpc: "2.0", method: "mining.set_extranonce", params: ["new-prefix", 5] };
    app.currPoolExtraNonceAlgo = "kawpow";
    app.currPoolLastTarget = { jsonrpc: "2.0", method: "mining.set_difficulty", params: [2] };
    app.currPoolLastJob = ethNotifyParams("kawpow-job");

    app.sendFirstJob({ id: 2, method: "login", params: { extensions: ["mo-native"] } }, jsonSink(minerWrites));

    assert.equal(minerWrites[0].result.id, "pool-miner");
    assert.equal(minerWrites[0].result.algo, "kawpow");
    assert.equal(minerWrites[0].result.extra_nonce, "new-prefix");
    assert.equal(minerWrites[0].result.extra_nonce2_size, 5);
    assert.deepEqual(minerWrites[0].result.extensions, ["mo-native"]);
    assert.equal("job" in minerWrites[0].result, false);
    assert.deepEqual(minerWrites[1].params, ["new-prefix", 5]);
    assert.equal(minerWrites[1].algo, "kawpow");
    assert.equal(minerWrites[2].method, "mining.set_difficulty");
    assert.equal(minerWrites[2].algo, "kawpow");
    assert.deepEqual(minerWrites[3].params, app.currPoolLastJob);
    assert.equal(minerWrites[3].algo, "kawpow");
  });

  it("rejects a native array job for an object child without mo-native", () => {
    const app = ethProxyApp("mm-native-object-legacy-");
    const minerWrites = [];
    app.minerServer.protocol = "default";
    app.currAlgo = "kawpow";
    app.currPoolJobAlgo = "kawpow";
    app.currPoolLastJob = ethNotifyParams("kawpow-job");

    app.sendFirstJob({ id: 2, method: "login", params: {} }, jsonSink(minerWrites));

    assert.equal(minerWrites.length, 1);
    assert.equal(minerWrites[0].id, 2);
    assert.match(minerWrites[0].error, /mo-native/);
  });

  it("filters a native pool job from an already connected legacy object child", () => {
    const app = ethProxyApp("mm-native-object-switch-");
    const minerWrites = [];
    app.minerServer.protocol = "default";
    app.minerServer.socket = jsonSink(minerWrites);
    app.currMiner = "miner --kawpow";
    app.config.algos = { kawpow: app.currMiner };
    app.currMinerSupportsMoNative = false;

    app.poolNewMsg({ jsonrpc: "2.0", method: "mining.notify", algo: "kawpow", params: ethNotifyParams("kawpow-job") });

    assert.equal(minerWrites.length, 0);
  });

  it("keeps an unmarked target pending for the next family job", () => {
    const app = ethProxyApp("mm-target-pending-");
    const target = { jsonrpc: "2.0", method: "mining.set_difficulty", params: [2] };
    app.currPoolJobAlgo = "rx/0";
    app.currPoolTargetAlgo = "rx/0";
    app.currPoolLastTarget = { jsonrpc: "2.0", method: "mining.set_difficulty", algo: "rx/0", params: [1] };
    app.recordPoolMessage(target);
    app.recordPoolMessage({ jsonrpc: "2.0", method: "mining.notify", algo: "kawpow", params: ethNotifyParams("kawpow-job") });

    assert.equal(app.currPoolLastTarget, target);
    assert.equal(app.currPoolTargetAlgo, "kawpow");
    assert.equal(app.currPoolTargetPending, false);
  });

  it("drops a marked target when the following job belongs to another family", () => {
    const app = ethProxyApp("mm-target-family-");
    const target = { jsonrpc: "2.0", method: "mining.set_difficulty", algo: "rx/0", params: [1] };
    app.currPoolJobAlgo = "rx/0";
    app.recordPoolMessage(target);
    app.recordPoolMessage({ jsonrpc: "2.0", method: "mining.notify", algo: "kawpow", params: ethNotifyParams("kawpow-job") });

    assert.equal(app.currPoolLastTarget, null);
  });

  it("replays a cached nonce prefix before the first native notify", () => {
    const app = ethProxyApp("mm-native-prefix-");
    const minerWrites = [];
    app.minerServer.protocol = "eth";
    app.currAlgo = "kawpow";
    app.currPoolLastTarget = null;
    app.currPoolLastExtraNonce = { jsonrpc: "2.0", method: "mining.set_extranonce", params: ["abcd", 4] };
    app.currPoolLastJob = ethNotifyParams("kawpow-job");

    app.sendFirstJob({ id: 2, method: "mining.authorize" }, jsonSink(minerWrites));

    assert.equal(minerWrites[0].method, "mining.set_extranonce");
    assert.equal(minerWrites[0].algo, "kawpow");
    assert.equal(minerWrites[1].method, "mining.notify");
  });

  it("sends cached autolykos difficulty before first notify", () => {
    const app = ethProxyApp("mm-autolykos-diff-");
    const minerWrites = [];
    app.minerServer.protocol = "eth";
    app.currAlgo = "autolykos2";
    app.currPoolLastTarget = { jsonrpc: "2.0", method: "mining.set_difficulty", params: [0.001] };
    app.currPoolLastJob = ethNotifyParams("job1");

    app.sendFirstJob({ id: 2, jsonrpc: "2.0", method: "mining.authorize", params: ["wallet", "x"] }, jsonSink(minerWrites));

    assert.equal(minerWrites[0].method, "mining.set_difficulty");
    assert.equal(minerWrites[1].method, "mining.notify");
  });

  it("keeps subscribe replies before first jobs for pipelined subscribe/authorize miners", () => {
    const app = ethProxyApp("mm-eth-order-");
    const minerWrites = [];
    const poolWrites = [];
    const socket = jsonSink(minerWrites);
    app.currPoolSocket = jsonSink(poolWrites);
    app.currPoolLastJob = { algo: "ghostrider", blob: "00", job_id: "job1", target: "ffffffff" };

    app.handleMinerSubscribe({ id: 1, jsonrpc: "2.0", method: "mining.subscribe", params: ["XMRig"] }, socket);
    app.handleMinerLogin({ id: 2, jsonrpc: "2.0", method: "mining.authorize", params: ["wallet", "x"] }, socket);
    app.sendFirstJob({ id: 2, jsonrpc: "2.0", method: "mining.authorize", params: ["wallet", "x"] }, socket);

    assert.equal(minerWrites.length, 1);
    assert.equal(minerWrites[0].id, 2);
    app.poolNewMsg({ id: 1, jsonrpc: "2.0", error: null, result: [["mining.notify", "live", "EthereumStratum/1.0.0"], "ff00", 6] });
    app.flushPendingEthFirstJob();

    assert.equal(poolWrites[0].method, "mining.subscribe");
    assert.equal(minerWrites[1].id, 1);
    assert.deepEqual(minerWrites[2], { jsonrpc: "2.0", method: "job", params: app.currPoolLastJob });
  });

  it("maps ETH proxy submits to pushed work headers", () => {
    const app = ethProxyApp("mm-ethproxy-push-");
    const poolWrites = [];
    const minerWrites = [];
    app.currPoolSocket = jsonSink(poolWrites);
    app.minerServer.socket = jsonSink(minerWrites);

    app.sendFirstJob({ id: 2, jsonrpc: "2.0", method: "eth_getWork", params: [] }, jsonSink(minerWrites));
    app.currPoolLastJob = ethNotifyParams("job2");
    app.poolNewMsg({ id: 0, jsonrpc: "2.0", result: ["0xpushheader", "0xseed", "0xtarget"], algo: "etchash" });
    app.handleEthProxySubmit({ id: 3, jsonrpc: "2.0", method: "eth_submitWork", params: ["0x00", "0xpushheader", "0x11"] }, { write() {} });

    assert.equal(minerWrites.length, 2);
    assert.deepEqual(minerWrites[1], { id: 0, jsonrpc: "2.0", result: ["0xpushheader", "0xseed", "0xtarget"], algo: "etchash" });
    assert.equal(poolWrites.length, 1);
    assert.equal(poolWrites[0].method, "mining.submit");
    assert.equal(poolWrites[0].params[1], "job2");
  });

  it("rejects unknown ETH proxy submit headers locally", () => {
    const app = ethProxyApp("mm-ethproxy-");
    const poolWrites = [];
    const minerWrites = [];
    app.currPoolSocket = jsonSink(poolWrites);

    app.handleEthProxySubmit({ id: 3, jsonrpc: "2.0", method: "eth_submitWork", params: ["0x00", "0xdead", "0x11"] }, jsonSink(minerWrites));

    assert.equal(poolWrites.length, 0);
    assert.deepEqual(minerWrites[0], { jsonrpc: "2.0", id: 3, error: null, result: false });
  });

  it("reports config errors and warnings", () => {
    const config = createDefaultConfig();
    const result = validateConfig(config);
    assert.ok(result.errors.includes("You must specify at least one pool"));
    assert.match(formatDiagnostics(config), /Multi-Miner diagnostics/);
  });

  it("uses configured c29 miner for MoneroOcean cuckaroo jobs", () => {
    const app = new MultiMinerApp([], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "mm-c29-")) });
    app.config.algos = { c29: "miner --c29" };
    app.startMinerProcess = () => ({ pid: 0, on() {}, once() {} });
    app.poolNewMsg({
      id: 1,
      jsonrpc: "2.0",
      error: null,
      result: {
        id: "pool-miner",
        status: "OK",
        job: {
          algo: "cuckaroo",
          proofsize: 42,
          blob: "17b9ac16fe37c3e2f0bf8bb9fec6dae1f59a1f0ce1d40fdcfb33fab18b6ce28a",
          job_id: "c29-live",
        },
      },
    });
    assert.equal(app.currAlgo, "c29");
    assert.equal(app.currMiner, "miner --c29");
  });
});

function ethProxyApp(tmpPrefix) {
  const app = new MultiMinerApp([], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), tmpPrefix)) });
  app.logger = silentLogger();
  app.config.user = "wallet";
  app.minerServer.protocol = "ethproxy";
  app.currPoolLastTarget = { jsonrpc: "2.0", method: "mining.set_difficulty", params: [0.000001] };
  app.currPoolLastJob = ethNotifyParams("job1");
  return app;
}

function jsonSink(target) { return { write: (line) => target.push(JSON.parse(line)) }; }
