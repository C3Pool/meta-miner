"use strict";

const fs = require("fs");
const net = require("net");
const { createJsonLineParser } = require("../../src/json-lines");

const MAX_CAPTURE_CHARS = 4 * 1024 * 1024;

function assertNoLiveFailures(assert, results) {
  const failures = results.filter((result) => result.status === "failed");
  assert.equal(failures.length, 0, failures.map((result) => `${result.name  }: ${  result.reason  }\n${  result.output || ""}`).join("\n"));
}

function captureOutput(app, output) {
  let capturedChars = 0;
  const append = (message) => {
    let text = String(message);
    if (text.length > MAX_CAPTURE_CHARS) text = text.slice(-MAX_CAPTURE_CHARS);
    output.push(text);
    capturedChars += text.length;
    while (capturedChars > MAX_CAPTURE_CHARS && output.length > 1) {
      capturedChars -= output.shift().length;
    }
  };
  app.logger.log = (message) => append(`>>> ${  message}`);
  app.logger.err = (message) => append(`!!! ${  message}`);
  app.logger.miner = append;
}

function envInt(name, fallback) { return Number.parseInt(process.env[name] || String(fallback), 10); }

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function createJsonLineServer(onLine, extra) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    const parser = createJsonLineParser((json) => onLine(socket, json), undefined, extra && extra.maxLineBytes);
    socket.on("error", () => {});
    socket.on("data", (chunk) => parser.push(chunk));
  });
  let closePromise;
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve({
      close: () => {
        if (!closePromise) {
          closePromise = new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(done);
          });
        }
        return closePromise;
      },
      port: server.address().port,
      ...(extra || {}),
    }));
    server.on("error", reject);
  });
}

function quoteForCommand(value) { return `"${  String(value).replace(/["\\$`]/g, "\\$&")  }"`; }

function shellQuote(value) { return `'${  String(value).replace(/'/g, "'\\''")  }'`; }

function selectedCases(cases, envName) {
  const requested = new Set((process.env[envName] || "").split(",").filter(Boolean));
  return cases.filter((testCase) => !requested.size || requested.has(testCase.name));
}

function writeLiveConfig(configPath, minerPort, poolPort, algo, command) {
  fs.writeFileSync(configPath, JSON.stringify({
    miner_host: "127.0.0.1",
    miner_port: minerPort,
    pools: [`127.0.0.1:${  poolPort}`],
    algos: { [algo]: command },
    algo_perf: { [algo]: 1 },
    user: "wallet",
    pass: "x",
    watchdog: 0,
    hashrate_watchdog: 0,
  }, null, 2));
}

function tail(text) { return text.split(/\r?\n/).slice(-80).join("\n"); }

async function waitForLiveSubmit(pool, name, output, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (pool.submits.length > 0) return "submit";
    await delay(500);
  }
  throw new Error(`${name  } timed out; tail:\n${  tail(output.join("\n"))}`);
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function printSimpleResult(prefix, result) {
  const suffix = result.status === "passed" ? `(${  result.outcome  })` : result.reason;
  process.stdout.write(`${prefix  }: ${  result.name  } ${  result.status  } ${  suffix  }\n`);
}

function words(value) { return value.trim().split(/\s+/).filter(Boolean); }

module.exports = {
  assertNoLiveFailures,
  captureOutput,
  createJsonLineServer,
  delay,
  envInt,
  freePort,
  printSimpleResult,
  quoteForCommand,
  selectedCases,
  shellQuote,
  tail,
  waitForLiveSubmit,
  withTimeout,
  words,
  writeLiveConfig,
};
