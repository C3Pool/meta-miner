"use strict";

const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { describe, it } = require("node:test");

const { MultiMinerApp } = require("../mm");
const { createJsonLineParser, stringifyLine } = require("../src/json-lines");
const { ethSubscribeResult } = require("../src/protocol");
const { createFakePool, ethNotifyParams, fakeMinerCommand, freePort } = require("./common/helpers");
const { captureOutput, createJsonLineServer, delay, withTimeout } = require("./common/live-helpers");

if (process.argv[2] === "--fake-eth-child") {
  runFakeEthChild(Number.parseInt(process.argv[3], 10)).catch((error) => {
    process.stderr.write(`fake-eth-child-error: ${  error.message  }\n`);
    process.exitCode = 2;
  });
} else {
describe("fake-pool integration", { concurrency: false }, () => {
  it("closes an active fake-pool client promptly", async () => {
    let accepted;
    let acceptedSocket;
    let resolveSocketClosed;
    const acceptedPromise = new Promise((resolve) => { accepted = resolve; });
    const socketClosed = new Promise((resolve) => { resolveSocketClosed = resolve; });
    const pool = await createJsonLineServer((socket) => {
      acceptedSocket = socket;
      socket.once("close", resolveSocketClosed);
      accepted();
    });
    const client = net.connect(pool.port, "127.0.0.1");
    client.on("error", () => {});
    const connected = new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });
    const closed = new Promise((resolve) => client.once("close", resolve));

    try {
      await withTimeout(connected, 1000, "fake-pool client did not connect");
      client.write("{}\n");
      await withTimeout(acceptedPromise, 1000, "fake-pool server did not accept the client");
      await withTimeout(pool.close(), 1000, "fake-pool close did not resolve");
      await withTimeout(closed, 1000, "fake-pool client did not close");
      await withTimeout(socketClosed, 1000, "fake-pool server socket did not close");
      assert.equal(client.destroyed, true);
      assert.equal(acceptedSocket.destroyed, true);
      await pool.close();
    } finally {
      client.destroy();
      await pool.close().catch(() => {});
    }
  });

  it("logs in, switches algo, and forwards miner submit", async () => {
    const minerPort = await freePort();
    const pool = await createFakePool("rx/0");
    const app = new MultiMinerApp([
      "--no-config-save",
      "--watchdog=0",
      `--pool=127.0.0.1:${  pool.port}`,
      "--user=wallet",
      "--pass=x",
      `--port=${  minerPort}`,
      "--perf_rx/0=1",
      `--rx/0=${  fakeMinerCommand(minerPort, "default", "rx/0")}`,
    ], appOptions());

    try {
      await app.run();
      const login = await pool.login;
      assert.equal(login.method, "login");
      assert.ok(login.params.algo.includes("rx/0"));
      assert.deepEqual(login.params.extensions, ["mo-native"]);
      const submit = await pool.submit;
      assert.equal(submit.method, "submit");
    } finally {
      await app.stop();
      await pool.close();
    }
  });

  it("supports ETH subscribe/authorize protocol helpers", async () => {
    const minerPort = await freePort();
    const pool = await createFakePool("etchash", "eth");
    const app = new MultiMinerApp([
      "--no-config-save",
      "--watchdog=0",
      `--pool=127.0.0.1:${  pool.port}`,
      "--user=wallet",
      "--pass=x",
      `--port=${  minerPort}`,
      "--perf_etchash=1",
      `--etchash=${  fakeMinerCommand(minerPort, "eth", "etchash")}`,
    ], appOptions());

    try {
      await app.run();
      await pool.login;
      const submit = await pool.submit;
      assert.equal(submit.method, "mining.submit");
    } finally {
      await app.stop();
      await pool.close();
    }
  });

  it("supports ETH proxy login/getWork/submitWork helpers", async () => {
    const minerPort = await freePort();
    const pool = await createFakePool("etchash", "eth");
    const app = new MultiMinerApp([
      "--no-config-save",
      "--watchdog=0",
      `--pool=127.0.0.1:${  pool.port}`,
      "--user=wallet",
      "--pass=x",
      `--port=${  minerPort}`,
      "--perf_etchash=1",
      `--etchash=${  fakeMinerCommand(minerPort, "ethproxy", "etchash")}`,
    ], appOptions());

    try {
      await app.run();
      await pool.login;
      const submit = await pool.submit;
      assert.equal(submit.method, "mining.submit");
    } finally {
      await app.stop();
      await pool.close();
    }
  });

  it("recognizes untagged Pearl jobs and forwards large proof submissions", async () => {
    const minerPort = await freePort();
    const pool = await createFakePool("pearlhash", "pearl");
    const app = new MultiMinerApp([
      "--no-config-save",
      "--watchdog=0",
      `--pool=127.0.0.1:${  pool.port}`,
      "--user=wallet",
      "--pass=x",
      `--port=${  minerPort}`,
      "--perf_pearlhash=0",
      `--pearlhash=${  fakeMinerCommand(minerPort, "pearl", "pearlhash")}`,
    ], appOptions());
    const output = [];
    captureOutput(app, output);

    try {
      await app.run();
      const login = await pool.login;
      assert.ok(login.params.algo.includes("pearlhash"));
      const submit = await pool.submit;
      assert.equal(app.currAlgo, "pearlhash");
      assert.equal(app.config.algo_perf.pearlhash, 1e12);
      assert.equal(submit.method, "mining.submit");
      assert.equal(Array.isArray(submit.params), false);
      assert.equal(submit.params.job_id, "pearl-job-1");
      assert.equal(submit.params.proof_encoding, "gzip");
      const proof = zlib.gunzipSync(Buffer.from(submit.params.plain_proof, "base64"));
      assert.ok(proof.toString("base64").length > 1024 * 1024);
      assert.doesNotMatch(output.join("\n"), /Line exceeded|Can't parse message from the miner/);
    } finally {
      await app.stop();
      await pool.close();
    }
  });

  it("switches one pool session etchash to Pearl and back with correlated submits", async () => {
    const minerPort = await freePort();
    const jobIds = ["etchash-stage-1", "pearl-stage-2", "etchash-stage-3"];
    const stageByJobId = new Map([
      [jobIds[0], "etchash"],
      [jobIds[1], "pearlhash"],
      [jobIds[2], "etchash"],
    ]);
    const submissions = [];
    const submitAcks = [];
    const poolSockets = new Set();
    const startedPids = [];
    let loginCount = 0;
    let resolveSubmits;
    let resolveAcks;
    const allSubmits = new Promise((resolve) => { resolveSubmits = resolve; });
    const allAcks = new Promise((resolve) => { resolveAcks = resolve; });
    const pearlJob = {
      jsonrpc: "2.0",
      id: null,
      method: "mining.notify",
      params: {
        cert_version: 3,
        header: "00".repeat(76),
        job_id: jobIds[1],
        proof_encodings: ["none", "gzip"],
        target: "00".repeat(32),
      },
    };
    const send = (socket, message) => socket.write(stringifyLine(message));
    const sendEtchashJob = (socket, jobId) => {
      send(socket, { jsonrpc: "2.0", method: "mining.set_difficulty", params: [0.001] });
      send(socket, { jsonrpc: "2.0", method: "mining.notify", algo: "etchash", params: ethNotifyParams(jobId) });
    };

    const pool = await createJsonLineServer((socket, json) => {
      poolSockets.add(socket);
      if (json.method === "login") {
        loginCount += 1;
        send(socket, { id: json.id, jsonrpc: "2.0", error: null, result: { id: "pool-worker", status: "OK" } });
        if (loginCount === 1) sendEtchashJob(socket, jobIds[0]);
        return;
      }
      if (json.method === "mining.subscribe") {
        send(socket, { id: json.id, jsonrpc: "2.0", error: null, result: ethSubscribeResult("switch") });
        return;
      }
      if (json.method !== "mining.submit") return;

      const params = json.params;
      const jobId = Array.isArray(params) ? params[1] : params && params.job_id;
      const stage = stageByJobId.get(jobId) || "unknown";
      let pearlProofDecoded = false;
      const pearlEncoding = !Array.isArray(params) && params && params.proof_encoding;
      if (pearlEncoding === "gzip") {
        try {
          pearlProofDecoded = zlib.gunzipSync(Buffer.from(params.plain_proof, "base64")).length > 0;
        } catch { pearlProofDecoded = false; }
      }
      submissions.push({
        stage,
        method: json.method,
        paramsArray: Array.isArray(params),
        pearlEncoding: pearlEncoding || null,
        pearlProofDecoded,
        upstreamId: json.id,
      });
      send(socket, { id: json.id, jsonrpc: "2.0", error: null, result: true });
      if (submissions.length === 1) send(socket, pearlJob);
      if (submissions.length === 2) sendEtchashJob(socket, jobIds[2]);
      if (submissions.length === 3) resolveSubmits();
    }, { maxLineBytes: 12 * 1024 * 1024 });

    const app = new MultiMinerApp([
      "--no-config-save",
      "--watchdog=0",
      `--pool=127.0.0.1:${  pool.port}`,
      "--user=test-user",
      "--pass=test-pass",
      `--port=${  minerPort}`,
      "--perf_etchash=1",
      "--perf_pearlhash=1",
    ], Object.assign(appOptions(), { skipMinerCheck: true }));
    app.config.algos.etchash = fakeMinerCommand(minerPort, "eth", "etchash");
    app.config.algos.pearlhash = fakeMinerCommand(minerPort, "pearl", "pearlhash");
    const output = [];
    captureOutput(app, output);
    const startMiner = app.startMinerProcess.bind(app);
    app.startMinerProcess = (command, outCb) => {
      const process = startMiner(command, outCb);
      if (process && process.pid) startedPids.push(process.pid);
      return process;
    };
    const writeMiner = app.minerServer.write.bind(app.minerServer);
    app.minerServer.write = (socket, message) => {
      const frame = typeof message === "string" ? JSON.parse(message) : message;
      if (frame && frame.id === 3 && frame.error === null && frame.result === true) {
        submitAcks.push({ id: frame.id, result: frame.result });
        if (submitAcks.length === 3) resolveAcks();
      }
      return writeMiner(socket, message);
    };

    try {
      await app.run();
      await withTimeout(Promise.all([allSubmits, allAcks]), 15000,
        `fake children did not complete the Pearl switch sequence (${  loginCount  } logins, ${  submissions.length  } submits, ${  submitAcks.length  } ACKs, ${  startedPids.length  } children)`);

      assert.equal(loginCount, 1, "all three algo stages reuse one upstream login");
      assert.equal(poolSockets.size, 1, "all three algo stages reuse one upstream socket");
      assert.deepEqual(submissions.map(({ stage }) => stage), ["etchash", "pearlhash", "etchash"]);
      assert.ok(submissions.every(({ method }) => method === "mining.submit"), "each stage forwards a mining.submit");
      assert.equal(submissions[1].paramsArray, false, "Pearl remains an object submission");
      assert.equal(submissions[1].pearlEncoding, "gzip", "Pearl is advertised as gzip");
      assert.equal(submissions[1].pearlProofDecoded, true, "the forwarded Pearl proof is valid gzip");
      assert.equal(new Set(submissions.map(({ upstreamId }) => upstreamId)).size, 3, "each stage gets a distinct upstream request ID");
      assert.deepEqual(submitAcks.map(({ id, result }) => ({ id, result })), [
        { id: 3, result: true },
        { id: 3, result: true },
        { id: 3, result: true },
      ], "each child receives its correlated submit ACK");
      assert.equal(submissions.length, 3, "exactly one submit is forwarded per algo stage");
      assert.equal(startedPids.length, 3, "one fake child starts for each algo stage");
      assert.equal(new Set(startedPids).size, 3, "each algo stage uses a distinct fake child");
      assert.equal(app.currAlgo, "etchash", "the final active algo is etchash");
    } finally {
      await app.stop();
      await pool.close();
    }

    assert.equal(app.minerProc, null, "the final child is torn down");
    assert.equal(app.minerServer.socket, null, "the miner socket is torn down");
    assert.ok([...poolSockets].every((socket) => socket.destroyed), "the upstream socket is torn down");
  });

  it("switches real fake children across marked ETH, C29, and ETH jobs", async () => {
    const minerPort = await freePort();
    const jobIds = ["kawpow-job-1", "c29-job-2", "etchash-job-3"];
    const jobAlgos = new Map([
      [jobIds[0], "kawpow"],
      [jobIds[1], "c29"],
      [jobIds[2], "etchash"],
    ]);
    const expectedSubmits = [
      { algo: "kawpow", method: "mining.submit", jobId: jobIds[0] },
      { algo: "c29", method: "submit", jobId: jobIds[1] },
      { algo: "etchash", method: "mining.submit", jobId: jobIds[2] },
    ];
    const submissions = [];
    const childProcesses = [];
    const previousChildStates = [];
    const submitResolvers = [];
    const submitPromises = expectedSubmits.map(() => new Promise((resolve) => submitResolvers.push(resolve)));
    const poolSockets = new Set();
    let loginCount = 0;

    const kawpowCommand = fakeMinerCommand(minerPort, "eth", "kawpow");
    const c29Command = fakeMinerCommand(minerPort, "default", "c29");
    const etchashCommand = fakeMinerCommand(minerPort, "eth", "etchash");
    const kawpowJob = { jsonrpc: "2.0", method: "mining.notify", algo: "kawpow", params: ethNotifyParams(jobIds[0]) };
    const c29Job = {
      jsonrpc: "2.0",
      method: "job",
      params: { algo: "c29", blob: "00", height: 2, job_id: jobIds[1], target: "ffffffff" },
    };
    const etchashJob = { jsonrpc: "2.0", method: "mining.notify", algo: "etchash", params: ethNotifyParams(jobIds[2]) };

    const pool = await createJsonLineServer((socket, json) => {
      poolSockets.add(socket);
      const send = (message) => socket.write(stringifyLine(message));

      if (json.method === "login") {
        loginCount += 1;
        send({ id: json.id, jsonrpc: "2.0", error: null, result: { id: "pool-worker", status: "OK" } });
        if (loginCount === 1) {
          send({ jsonrpc: "2.0", method: "mining.set_target", algo: "kawpow", params: ["target-kawpow"] });
          send({ jsonrpc: "2.0", method: "mining.set_extranonce", algo: "kawpow", params: ["extra-kawpow", 4] });
          send(kawpowJob);
        }
        return;
      }
      if (json.method === "mining.subscribe") {
        send({ id: json.id, jsonrpc: "2.0", error: null, result: ethSubscribeResult(String(json.id)) });
        return;
      }
      if (json.method !== "submit" && json.method !== "mining.submit") return;

      const jobId = json.method === "submit" ? json.params.job_id : json.params[1];
      const index = submissions.length;
      submissions.push({ algo: jobAlgos.get(jobId) || "unknown", jobId, method: json.method, json });
      if (childProcesses.length > 0) {
        const previous = childProcesses[childProcesses.length - 1];
        previousChildStates.push({ exitCode: previous && previous.exitCode, signalCode: previous && previous.signalCode });
      }
      childProcesses.push(app && app.minerProc);
      send({ id: json.id, jsonrpc: "2.0", error: null, result: { status: "OK" } });
      if (index === 0) send(c29Job);
      if (index === 1) {
        send({ jsonrpc: "2.0", method: "mining.set_target", algo: "etchash", params: ["target-etchash"] });
        send({ jsonrpc: "2.0", method: "mining.set_extranonce", algo: "etchash", params: ["extra-etchash", 4] });
        send(etchashJob);
      }
      if (submitResolvers[index]) submitResolvers[index]();
    });

    const app = new MultiMinerApp([
      "--no-config-save",
      "--watchdog=0",
      `--pool=127.0.0.1:${  pool.port}`,
      "--user=wallet",
      "--pass=x",
      `--port=${  minerPort}`,
      "--perf_kawpow=1",
      "--perf_c29=1",
      "--perf_etchash=1",
      `--kawpow=${  kawpowCommand}`,
      `--c29=${  c29Command}`,
      `--etchash=${  etchashCommand}`,
    ], appOptions());

    try {
      await app.run();
      await withTimeout(Promise.all(submitPromises), 15000, "fake children did not submit all three jobs");

      assert.equal(loginCount, 1, "all child switches reuse one upstream pool login");
      assert.equal(poolSockets.size, 1, "all child switches reuse one upstream pool socket");
      assert.deepEqual(submissions.map(({ algo, jobId, method }) => ({ algo, jobId, method })), expectedSubmits);
      assert.equal(new Set(childProcesses.map((process) => process && process.pid)).size, 3, "each submit came from a distinct child PID");
      assert.ok(childProcesses.every((process) => process && process.pid), "each submit had a live child process handle");
      for (let index = 0; index < previousChildStates.length; index++) {
        const previous = previousChildStates[index];
        assert.ok(previous.exitCode !== null || previous.signalCode !== null,
          `child ${  index + 1  } submitted before the previous child exited`);
      }
    } finally {
      await app.stop();
      await pool.close();
    }
  });

  it("reconnects one ETH child after the upstream pool socket is replaced", async () => {
    const minerPort = await freePort();
    const jobs = [
      { jobId: "etchash-old-job", extraNonce: "extra-old", difficulty: 1 },
      { jobId: "etchash-new-job", extraNonce: "extra-new", difficulty: 2 },
    ];
    const connections = [];
    const loginFrames = [];
    const upstreamJobs = [];
    const submissions = [];
    let secondLoginHasNativeMetadata = false;
    let firstSocketCloseScheduled = false;
    let resolveFirstSubmit;
    let resolveSecondSubmit;
    const firstSubmit = new Promise((resolve) => { resolveFirstSubmit = resolve; });
    const secondSubmit = new Promise((resolve) => { resolveSecondSubmit = resolve; });

    const pool = await createJsonLineServer((socket, json) => {
      let connection = connections.find((entry) => entry.socket === socket);
      if (!connection) {
        connection = { socket, number: connections.length + 1, closed: false };
        connections.push(connection);
        socket.once("close", () => { connection.closed = true; });
      }
      const send = (message) => socket.write(stringifyLine(message));

      if (json.method === "login") {
        const loginNumber = loginFrames.length + 1;
        const params = json.params && typeof json.params === "object" ? json.params : {};
        loginFrames.push({
          connection: connection.number,
          id: json.id,
          algos: Array.isArray(params.algo) ? params.algo.slice() : [],
          extensions: Array.isArray(params.extensions) ? params.extensions.slice() : [],
        });
        const result = loginNumber === 2
          ? {
            id: "pool-worker-2",
            status: "OK",
            extensions: ["mo-native"],
            extra_nonce: "native-prefix-2",
            extra_nonce2_size: 4,
          }
          : { id: "pool-worker-1", status: "OK" };
        if (loginNumber === 2) secondLoginHasNativeMetadata = true;
        send({ id: json.id, jsonrpc: "2.0", error: null, result });
        const job = jobs[loginNumber - 1];
        if (!job) return;
        upstreamJobs.push({ connection: connection.number, jobId: job.jobId });
        send({ jsonrpc: "2.0", method: "mining.set_extranonce", algo: "etchash", params: [job.extraNonce, 4] });
        send({ jsonrpc: "2.0", method: "mining.set_difficulty", algo: "etchash", params: [job.difficulty] });
        send({ jsonrpc: "2.0", method: "mining.notify", algo: "etchash", params: ethNotifyParams(job.jobId) });
        return;
      }
      if (json.method === "mining.subscribe") {
        send({ id: json.id, jsonrpc: "2.0", error: null, result: ethSubscribeResult(`session-${  connection.number}`) });
        return;
      }
      if (json.method !== "mining.submit") return;

      const jobId = Array.isArray(json.params) ? json.params[1] : null;
      const worker = Array.isArray(json.params) ? json.params[0] : null;
      const submission = { connection: connection.number, jobId, method: json.method, worker };
      submissions.push(submission);
      send({ id: json.id, jsonrpc: "2.0", error: null, result: true });
      if (connection.number === 1 && !firstSocketCloseScheduled) {
        firstSocketCloseScheduled = true;
        setTimeout(() => socket.end(), 20);
      }
      if (submissions.length === 1) resolveFirstSubmit(submission);
      if (submissions.length === 2) resolveSecondSubmit(submission);
    });

    const output = [];
    const app = new MultiMinerApp([
      "--no-config-save",
      "--watchdog=0",
      `--pool=127.0.0.1:${  pool.port}`,
      "--user=test-user",
      "--pass=test-pass",
      `--port=${  minerPort}`,
      "--perf_etchash=1",
    ], {
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), "mm-reconnect-")),
      reconnectDelayMs: 30,
      skipMinerCheck: true,
    });
    app.config.algos.etchash = fakeEthReconnectCommand(minerPort);
    captureOutput(app, output);

    try {
      await app.run();
      await withTimeout(Promise.all([firstSubmit, secondSubmit]), 12000, "fake ETH child did not submit both jobs");
      await delay(100);

      assert.equal(connections.length, 2, "the fake pool accepted exactly two upstream connections");
      assert.equal(loginFrames.length, 2, "the app logged in once per upstream connection");
      assert.deepEqual(loginFrames.map((frame) => frame.algos), [["etchash"], ["etchash"]]);
      assert.ok(loginFrames.every((frame) => frame.extensions.includes("mo-native")), "both upstream logins advertise mo-native");
      assert.equal(secondLoginHasNativeMetadata, true, "the replacement session supplied native login metadata");
      assert.deepEqual(upstreamJobs, [
        { connection: 1, jobId: jobs[0].jobId },
        { connection: 2, jobId: jobs[1].jobId },
      ]);
      assert.deepEqual(submissions.map(({ connection, jobId, method }) => ({ connection, jobId, method })), [
        { connection: 1, jobId: jobs[0].jobId, method: "mining.submit" },
        { connection: 2, jobId: jobs[1].jobId, method: "mining.submit" },
      ]);
      assert.equal(firstSocketCloseScheduled, true, "only the first upstream socket was closed by the fake pool");
      assert.equal(connections[0].closed, true, "the first upstream socket closed");
      assert.equal(connections[1].closed, false, "the replacement upstream socket remained open");

      const childEvents = parseFakeEthEvents(output);
      const childJobs = childEvents.filter((event) => event.event === "job");
      assert.equal(childJobs.length, 2, "the same child made one local connection per upstream session");
      assert.equal(new Set(childJobs.map((event) => event.pid)).size, 1, "both local connections came from one child PID");
      assert.equal(new Set(submissions.map((submission) => submission.worker)).size, 1, "both submits carry one synthetic worker PID");
      assert.equal(submissions[0].worker, `fake-worker-${  childJobs[0].pid}`);
      assert.equal(childEvents.filter((event) => event.event === "raw_login_reply").length, 0,
        "an upstream object login reply was never delivered as an ETH reply");
      const submitAcks = childEvents.filter((event) => event.event === "submit_ack");
      assert.deepEqual(submitAcks.map(({ connection }) => connection), [1, 2],
        "each ETH session received its own submit ACK");
      assert.equal(childEvents.filter((event) => event.event === "parse_error").length, 0,
        "the fake child parsed every downstream frame");

      assert.deepEqual(childJobs.map(({ connection, jobId }) => ({ connection, jobId })), [
        { connection: 1, jobId: jobs[0].jobId },
        { connection: 2, jobId: jobs[1].jobId },
      ]);
      for (const connectionNumber of [1, 2]) {
        const session = childEvents.filter((event) => event.connection === connectionNumber);
        const subscribeReplies = session.filter((event) => event.event === "subscribe_reply");
        const authorizeReplies = session.filter((event) => event.event === "authorize_reply");
        const jobIndex = session.findIndex((event) => event.event === "job");
        assert.equal(subscribeReplies.length, 1, `session ${  connectionNumber  } received one subscribe reply`);
        assert.equal(subscribeReplies[0].fields, 2, `session ${  connectionNumber  } received the two-field ETH subscribe reply`);
        assert.equal(authorizeReplies.length, 1, `session ${  connectionNumber  } received one authorize reply`);
        assert.equal(authorizeReplies[0].accepted, true, `session ${  connectionNumber  } was authorized`);
        assert.ok(jobIndex > 0, `session ${  connectionNumber  } received a first job`);
        assert.ok(session.slice(0, jobIndex).some((event) => event.event === "control" &&
          event.method === "mining.set_extranonce" && event.paramsLength === 1),
        `session ${  connectionNumber  } received ETH extranonce framing before its job`);
        assert.ok(session.slice(0, jobIndex).some((event) => event.event === "control" &&
          event.method === "mining.set_difficulty" && event.paramsLength === 1),
        `session ${  connectionNumber  } received difficulty before its job`);
      }
    } finally {
      await app.stop();
      await pool.close();
    }
  });
});
}

function appOptions() {
  return { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "mm-app-")), reconnectDelayMs: 1000 };
}

function fakeEthReconnectCommand(port) {
  return `${quoteCommand(process.execPath)} ${  quoteCommand(path.resolve(__filename))  } --fake-eth-child ${  port}`;
}

function quoteCommand(value) {
  return `"${  String(value).replace(/["\\]/g, "\\$&")  }"`;
}

function parseFakeEthEvents(output) {
  return output.join("").split(/\r?\n/)
    .filter((line) => line.startsWith("FAKE_ETH_CHILD "))
    .map((line) => JSON.parse(line.slice("FAKE_ETH_CHILD ".length)));
}

function runFakeEthChild(port) {
  if (!Number.isInteger(port) || port < 1) throw new Error("invalid fake child port");
  let connectionNumber = 0;

  function report(event, details) {
    process.stdout.write(`FAKE_ETH_CHILD ${  JSON.stringify(Object.assign({ event }, details || {}))  }\n`);
  }

  function connect() {
    const socket = net.connect(port, "127.0.0.1");
    let connection = 0;
    let connected = false;
    let reconnectScheduled = false;
    let submitted = false;
    const scheduleReconnect = () => {
      if (reconnectScheduled) return;
      reconnectScheduled = true;
      if (connected) report("downstream_closed", { connection });
      setTimeout(connect, 100);
    };
    const parser = createJsonLineParser((json) => {
      if (json.result && typeof json.result === "object" && !Array.isArray(json.result) &&
          json.result.id && json.result.status === "OK") {
        report("raw_login_reply", { connection });
        return;
      }
      if (json.id === 1 && Array.isArray(json.result)) {
        report("subscribe_reply", { connection, fields: json.result.length });
        return;
      }
      if (json.id === 2 && json.result === true) {
        report("authorize_reply", { connection, accepted: true });
        return;
      }
      if (json.method === "mining.set_extranonce" || json.method === "set_extranonce" ||
          json.method === "mining.set_difficulty" || json.method === "mining.set_target") {
        report("control", { connection, method: json.method, paramsLength: Array.isArray(json.params) ? json.params.length : -1 });
        return;
      }
      if (json.method === "mining.notify" && Array.isArray(json.params)) {
        const jobId = json.params[0];
        report("job", { connection, jobId, pid: process.pid });
        if (!submitted) {
          submitted = true;
          const worker = `fake-worker-${  process.pid}`;
          socket.write(stringifyLine({
            id: 3,
            jsonrpc: "2.0",
            method: "mining.submit",
            params: [worker, jobId, "00", "00", "00"],
          }));
          report("submit", { connection, jobId, pid: process.pid });
        }
        return;
      }
      if (json.id === 3 && json.error === null && (json.result === true ||
          (json.result && typeof json.result === "object" && json.result.status === "OK"))) {
        report("submit_ack", { connection, accepted: true });
      }
    }, () => report("parse_error", { connection }));
    socket.on("connect", () => {
      connected = true;
      connection = ++connectionNumber;
      report("connected", { connection, pid: process.pid });
      socket.write(stringifyLine({ id: 1, jsonrpc: "2.0", method: "mining.subscribe", params: [] }));
      socket.write(stringifyLine({ id: 2, jsonrpc: "2.0", method: "mining.authorize", params: ["fake-worker", "fake-pass"] }));
    });
    socket.on("data", (chunk) => parser.push(chunk));
    socket.on("end", scheduleReconnect);
    socket.on("close", scheduleReconnect);
    socket.on("error", scheduleReconnect);
  }

  connect();
  return Promise.resolve();
}
