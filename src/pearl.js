"use strict";

const zlib = require("zlib");

const MAX_PROOF_BYTES = 8 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_PROOF_BYTES / 3) * 4;

function gzipPearlSubmit(algo, job, message) {
  if (!supportsGzip(algo, job, message)) return message;
  const encoding = message.params.proof_encoding;
  if (encoding && encoding !== "none") return message;

  const proof = decodeProof(message.params.plain_proof);
  const compressed = zlib.gzipSync(proof, { level: zlib.constants.Z_BEST_SPEED });
  if (compressed.length >= proof.length) return message;

  return Object.assign({}, message, {
    params: Object.assign({}, message.params, {
      plain_proof: compressed.toString("base64"),
      proof_encoding: "gzip",
    }),
  });
}

function supportsGzip(algo, job, message) {
  if (algo !== "pearlhash" || !job || typeof job !== "object" || !message || message.method !== "mining.submit") return false;
  if (!message.params || typeof message.params !== "object" || Array.isArray(message.params)) return false;
  if (!isJobId(job.job_id) || !isJobId(message.params.job_id)) return false;
  if (String(job.job_id) !== String(message.params.job_id)) return false;
  return Array.isArray(job.proof_encodings) && job.proof_encodings.includes("gzip");
}

function isJobId(value) {
  return Number.isSafeInteger(value) || typeof value === "string" && value.length > 0;
}

function decodeProof(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_BASE64_CHARS ||
      value.length % 4 !== 0) {
    throw new Error("invalid canonical Pearl proof");
  }
  const proof = Buffer.from(value, "base64");
  if (proof.length > MAX_PROOF_BYTES || proof.toString("base64") !== value) {
    throw new Error("invalid canonical Pearl proof");
  }
  return proof;
}

module.exports = { gzipPearlSubmit };
