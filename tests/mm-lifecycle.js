"use strict";

const assert = require("assert");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it } = require("node:test");

const { MultiMinerApp } = require("../mm");
const { silentLogger } = require("./common/helpers");

describe("mm lifecycle", () => {
  it("stops promptly with an active miner socket", async () => {
    const app = new MultiMinerApp([], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "mm-stop-socket-")) });
    app.logger = silentLogger();
    app.config.miner_host = "127.0.0.1";
    app.config.miner_port = 0;
    await app.listen();

    const acceptedSocketPromise = new Promise((resolve) => app.minerServer.server.once("connection", resolve));
    const minerSocket = net.createConnection({ host: app.config.miner_host, port: app.minerServer.server.address().port });
    let acceptedSocket;
    let stopPromise;
    try {
      acceptedSocket = await acceptedSocketPromise;
      app.minerServer.setCurrent(acceptedSocket, "default");
      stopPromise = app.stop();
      let timer;
      await Promise.race([
        stopPromise,
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error("app.stop() did not resolve with an active miner socket")), 500);
        }),
      ]).finally(() => clearTimeout(timer));
    } finally {
      minerSocket.destroy();
      if (acceptedSocket) acceptedSocket.destroy();
      if (stopPromise) await stopPromise;
    }

    assert.equal(app.minerServer.socket, null, "active miner socket reference is cleared on stop");
    assert.equal(app.minerServer.server.listening, false, "miner listener is closed on stop");
    assert.equal(acceptedSocket.destroyed, true, "active miner socket is destroyed on stop");
  });

  it("clears the pool-retry reconnect timer on stop()", async () => {
    const app = new MultiMinerApp([], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "mm-stop-")), reconnectDelayMs: 60 * 1000 });
    app.logger = silentLogger();
    app.config.pools = ["127.0.0.1:1"];
    let reconnected = false;
    app.connectPool = () => { reconnected = true; };

    // Exhaust the (single) pool so poolErr schedules the 60s reconnect timer.
    app.currPoolNum = 0;
    app.poolErr(0);
    assert.ok(app.poolReconnectTimer, "reconnect timer was scheduled");

    // Before the fix this timer was untracked, so stop() could not cancel it and it
    // later fired connectPool against torn-down state.
    await app.stop();
    assert.equal(app.poolReconnectTimer, null, "reconnect timer reference is cleared on stop");

    // The timer must not fire after stop(); give the (cancelled) timer a chance.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(reconnected, false, "no reconnect is attempted after stop");
  });

  it("ignores a late pool login and job after stop()", async () => {
    const app = new MultiMinerApp([], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "mm-stop-late-pool-")) });
    app.logger = silentLogger();
    app.config.algos = { etchash: "late-miner" };
    let spawned = 0;
    app.startMinerProcess = () => { spawned += 1; return { pid: 1 }; };
    let destroyed = 0;
    const latePoolSocket = { destroy() { destroyed += 1; } };

    await app.stop();
    app.minerServer.socket = { write() {} };
    app.poolOk(0, latePoolSocket);
    app.poolNewMsg({ jsonrpc: "2.0", method: "job", algo: "etchash", params: [] }, latePoolSocket);

    assert.equal(destroyed, 1, "late pool socket is destroyed");
    assert.equal(app.currPoolSocket, null, "late pool login cannot install a current socket");
    assert.equal(app.currPoolLastJob, null, "late pool job cannot update pool state");
    assert.equal(spawned, 0, "late pool job cannot start a miner");
  });

  it("does not schedule a reconnect from poolErr() after stop()", async () => {
    const app = new MultiMinerApp([], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "mm-stop-late-error-")) });
    app.logger = silentLogger();
    let reconnects = 0;
    app.connectPool = () => { reconnects += 1; };

    await app.stop();
    app.poolErr(0);

    assert.equal(app.poolReconnectTimer, null, "no reconnect timer is scheduled after stop");
    assert.equal(reconnects, 0, "pool error cannot reconnect after stop");
  });

  it("does not spawn a pending replacement after stop()", async () => {
    const app = new MultiMinerApp([], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "mm-stop-replacement-")) });
    app.logger = silentLogger();
    let closeCallback;
    app.minerProc = {
      pid: 0,
      once(event, callback) {
        assert.equal(event, "close");
        closeCallback = callback;
      },
    };
    let spawned = 0;
    app.startMinerProcess = () => { spawned += 1; return { pid: 1 }; };

    app.replaceMiner("next-miner");
    assert.equal(app.nextMinerToRun, "next-miner", "replacement is pending before stop");
    await app.stop();
    closeCallback();

    assert.equal(app.nextMinerToRun, null, "pending replacement is cleared on stop");
    assert.equal(spawned, 0, "late replacement close cannot spawn a miner");
  });

  it("nulls minerProc on a non-respawn close so a stale handle can't wedge replaceMiner (#4)", () => {
    const app = new MultiMinerApp([], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "mm-close-")) });
    app.logger = silentLogger();
    app.minerProc = { pid: 1234 }; // a now-dead proc handle
    app.currPoolSocket = null;     // non-respawn path (pool down)
    app.handleMinerProcessClose("xmrig", 0, () => {});
    assert.equal(app.minerProc, null, "dead miner handle cleared on a non-respawn close");
  });

  it("defers a restart with backoff (not synchronous) while under the failure cap (#6)", () => {
    const app = new MultiMinerApp([], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "mm-backoff-")) });
    app.logger = silentLogger();
    app.currPoolSocket = {};
    app.isWantMinerKill = false;
    app.lastMinerStartTime = Date.now();
    let spawned = 0;
    app.startMinerProcess = () => { spawned += 1; return { pid: 1 }; };
    app.handleMinerProcessClose("xmrig", 1, () => {});
    assert.ok(app.minerRestartTimer, "a backoff restart timer was scheduled");
    assert.equal(spawned, 0, "restart is deferred, not synchronous (no fork/exec storm)");
    clearTimeout(app.minerRestartTimer); // cleanup so the deferred restart can't fire later
  });

  it("pauses miner auto-restart after the consecutive-failure cap (#6)", () => {
    const app = new MultiMinerApp([], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "mm-cap-")) });
    app.logger = silentLogger();
    app.currPoolSocket = {};
    app.isWantMinerKill = false;
    app.lastMinerStartTime = Date.now(); // recent -> failures accumulate (no reset)
    app.startMinerProcess = () => ({ pid: 1 });
    app.minerRestartFailures = 5;        // = MINER_RESTART_MAX
    app.handleMinerProcessClose("xmrig", 1, () => {}); // 6th failure -> over cap
    assert.equal(app.minerRestartTimer, null, "no restart scheduled once over the failure cap");
    assert.ok(app.minerRestartFailures > 5, "failure was counted");
  });
});
