"use strict";

// Cap a single line so a peer cannot grow the parser without bound. Ordinary
// Stratum remains at 1 MiB; callers may raise the cap only for a known protocol
// whose valid frames are larger (Pearl proofs are bounded separately).
const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;
const MAX_PROTOCOL_LOG_CHARS = 4096;

function stringifyLine(value) {
  return `${JSON.stringify(value)  }\n`;
}

function formatProtocolLog(value) {
  const serialized = typeof value === "string" ? value.replace(
    /("plain_proof"\s*:\s*")((?:\\.|[^"\\])*)(")/g,
    (_match, prefix, proof, suffix) => `${prefix}<redacted ${  proof.length  } characters>${suffix}`) :
    JSON.stringify(value, (key, item) =>
      key === "plain_proof" && typeof item === "string" ? `<redacted ${  item.length  } characters>` : item);
  const text = String(serialized);
  if (text.length <= MAX_PROTOCOL_LOG_CHARS) return text.trimEnd();
  return `${text.slice(0, MAX_PROTOCOL_LOG_CHARS)  }... <${  text.length  } characters total>`;
}

function createJsonLineParser(onJson, onInvalid, maxLineBytes) {
  let buffer = "";
  let bufferBytes = 0;
  // When a single line blows past the cap we drop it and stay in "discard" mode until
  // the next newline, so the abandoned garbage can never contaminate the following
  // legitimate frame; the parser resyncs cleanly at the next line boundary.
  let discarding = false;

  function currentMaxLineBytes() {
    const value = typeof maxLineBytes === "function" ? maxLineBytes() : maxLineBytes;
    return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_MAX_LINE_BYTES;
  }

  function handleLine(line) {
    if (Buffer.byteLength(line) > currentMaxLineBytes()) {
      if (onInvalid) onInvalid("", new Error(`Line exceeded ${  currentMaxLineBytes()  } bytes`));
      return;
    }
    const message = line.trim();
    if (!message) return;
    try {
      onJson(JSON.parse(message), message);
    } catch (error) {
      if (onInvalid) onInvalid(message, error);
    }
  }

  return {
    push(chunk) {
      let text = chunk.toString();
      if (discarding) {
        const newlineIndex = text.indexOf("\n");
        if (newlineIndex < 0) return;
        discarding = false;
        text = text.slice(newlineIndex + 1);
      }
      buffer += text;
      bufferBytes += Buffer.byteLength(text);
      // The retained buffer never contains a newline, so only the new chunk
      // needs scanning while a large proof arrives in many small chunks.
      if (!text.includes("\n")) {
        const limit = currentMaxLineBytes();
        if (bufferBytes > limit) {
          if (onInvalid) onInvalid("", new Error(`Line exceeded ${  limit  } bytes without a newline`));
          buffer = "";
          bufferBytes = 0;
          discarding = true;
        }
        return;
      }
      const lines = buffer.split("\n");
      // If the chunk ended on a newline the split leaves a trailing "" with no partial line to keep;
      // otherwise the last element is an incomplete line that must be carried over to the next chunk.
      buffer = buffer.endsWith("\n") ? "" : lines.pop();
      bufferBytes = Buffer.byteLength(buffer);
      for (const line of lines) handleLine(line);
    },
  };
}

module.exports = {
  createJsonLineParser,
  formatProtocolLog,
  stringifyLine,
};
