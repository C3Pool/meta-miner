"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { describe, it } = require("node:test");
const zlib = require("zlib");
const { MultiMinerApp } = require("../mm");
const { gzipPearlSubmit } = require("../src/pearl");

describe("Pearl submissions", () => {
  const job = { job_id: "pearl-job", proof_encodings: ["none", "gzip"] };

  it("uses advertised gzip for a canonical uncompressed proof", () => {
    const proof = Buffer.alloc(4096, "a");
    const message = submit(proof.toString("base64"));
    const compressed = gzipPearlSubmit("pearlhash", job, message);

    assert.notEqual(compressed, message);
    assert.equal(compressed.params.proof_encoding, "gzip");
    assert.deepEqual(zlib.gunzipSync(Buffer.from(compressed.params.plain_proof, "base64")), proof);
    assert.equal(message.params.proof_encoding, undefined);
  });

  it("produces identical claim data when the same share is retried", () => {
    const message = submit(Buffer.alloc(4096, "b").toString("base64"));
    assert.deepEqual(gzipPearlSubmit("pearlhash", job, message), gzipPearlSubmit("pearlhash", job, message));
  });

  it("keeps an uncompressed proof when gzip would increase its size", () => {
    const message = submit(crypto.randomBytes(64 * 1024).toString("base64"));
    assert.equal(gzipPearlSubmit("pearlhash", job, message), message);
  });

  it("leaves submissions unchanged without matching gzip negotiation", () => {
    const message = submit(Buffer.from("plain proof").toString("base64"));
    assert.equal(gzipPearlSubmit("pearlhash", { job_id: "pearl-job", proof_encodings: ["none"] }, message), message);
    assert.equal(gzipPearlSubmit("pearlhash", { job_id: "other-job", proof_encodings: ["gzip"] }, message), message);
    const legacy = Object.assign({}, message, { method: "submit" });
    assert.equal(gzipPearlSubmit("pearlhash", job, legacy), legacy);
  });

  it("does not leak Pearl compression into other algorithms or malformed job ids", () => {
    const message = submit(Buffer.from("plain proof").toString("base64"));
    assert.equal(gzipPearlSubmit("etchash", job, message), message);
    const malformed = Object.assign({}, message, {
      params: Object.assign({}, message.params, { job_id: { value: 2 } }),
    });
    assert.equal(gzipPearlSubmit("pearlhash",
      { job_id: { value: 1 }, proof_encodings: ["gzip"] }, malformed), malformed);
  });

  it("preserves proof data already encoded by the miner", () => {
    const message = submit("encoded", "gzip");
    assert.equal(gzipPearlSubmit("pearlhash", job, message), message);
  });

  it("rejects malformed uncompressed proof data before forwarding", () => {
    assert.throws(() => gzipPearlSubmit("pearlhash", job, submit("not base64")), /invalid canonical Pearl proof/);
  });

  it("accepts the proof-size boundary and rejects one byte beyond it", () => {
    const limit = 8 * 1024 * 1024;
    const atLimit = submit(Buffer.alloc(limit).toString("base64"));
    assert.equal(gzipPearlSubmit("pearlhash", job, atLimit).params.proof_encoding, "gzip");
    const overLimit = submit(Buffer.alloc(limit + 1).toString("base64"));
    assert.throws(() => gzipPearlSubmit("pearlhash", job, overLimit), /invalid canonical Pearl proof/);
  });

  it("compresses on the live forwarding path and rejects malformed input locally", () => {
    const app = new MultiMinerApp([]);
    const poolWrites = [];
    const minerWrites = [];
    const poolSocket = jsonSink(poolWrites);
    const minerSocket = jsonSink(minerWrites);
    app.currPoolSocket = poolSocket;
    app.minerServer.socket = minerSocket;
    app.currAlgo = "pearlhash";
    app.currPoolLastJob = job;
    app.logger = { err: () => {} };

    const proof = Buffer.alloc(4096, "c");
    app.forwardMinerRequest(submit(proof.toString("base64")), minerSocket);
    assert.equal(poolWrites[0].params.proof_encoding, "gzip");
    assert.deepEqual(zlib.gunzipSync(Buffer.from(poolWrites[0].params.plain_proof, "base64")), proof);
    assert.notEqual(poolWrites[0].id, 7);
    assert.equal(app.forwardPoolReply({ id: poolWrites[0].id, jsonrpc: "2.0", error: null, result: true }), true);
    assert.equal(minerWrites[0].id, 7);
    assert.equal(minerWrites[0].result, true);

    app.forwardMinerRequest(submit(proof.toString("base64")), minerSocket);
    assert.deepEqual(poolWrites[1].params, poolWrites[0].params);

    app.forwardMinerRequest(submit("not base64"), minerSocket);
    assert.equal(poolWrites.length, 2);
    assert.ok(minerWrites[1].error);
  });
});

function submit(plainProof, proofEncoding) {
  const params = { job_id: "pearl-job", plain_proof: plainProof, jackpot: "00".repeat(32), adjustment_factor: 128 };
  if (proofEncoding) params.proof_encoding = proofEncoding;
  return { jsonrpc: "2.0", id: 7, method: "mining.submit", params };
}

function jsonSink(writes) {
  return { write: (line) => writes.push(JSON.parse(line)) };
}
