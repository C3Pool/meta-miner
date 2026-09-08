"use strict";

const { DEFAULT_ALGO, normalizePoolAlgo } = require("./algorithms");
const { stringifyLine } = require("./json-lines");

function rememberJob(app, job, nextJobAlgo) {
  // A target/extra-nonce notification may be sent immediately before the job
  // that consumes it.  An unmarked control is therefore pending until the
  // next job identifies its family; a marked control can be rejected when it
  // belongs to the previous family.
  rememberPoolAlgo(app, nextJobAlgo);
  app.currPoolLastJob = job;
}

function clearTarget(app) {
  app.currPoolLastTarget = null;
  app.currPoolTargetAlgo = null;
  app.currPoolTargetPending = false;
}

function clearExtraNonce(app) {
  app.currPoolLastExtraNonce = null;
  app.currPoolExtraNonceAlgo = null;
  app.currPoolExtraNoncePending = false;
}

function controlFamily(app, familyKey, pendingKey) {
  if (app[familyKey] != null) return app[familyKey];
  // Tests and older callers may populate the legacy cached field directly.
  // Treat that value as belonging to the active family unless it was recorded
  // through rememberTarget/rememberExtraNonce as an unmarked pending control.
  return app[pendingKey] ? null : (app.currPoolJobAlgo != null ? app.currPoolJobAlgo : null);
}

function controlAlgo(json) {
  const params = json.params && typeof json.params === "object" ? json.params : {};
  const algo = json.algo || params.algo;
  return algo ? normalizePoolAlgo(algo, params) : null;
}

function rememberTarget(app, json) {
  app.currPoolLastTarget = json;
  app.currPoolTargetAlgo = controlAlgo(json);
  app.currPoolTargetPending = app.currPoolTargetAlgo == null;
}

function rememberExtraNonce(app, json) {
  app.currPoolLastExtraNonce = json;
  app.currPoolExtraNonceAlgo = controlAlgo(json);
  app.currPoolExtraNoncePending = app.currPoolExtraNonceAlgo == null;
}

function rememberPoolAlgo(app, nextJobAlgo) {
  if (nextJobAlgo == null) return;
  if (app.currPoolJobAlgo != null && app.currPoolJobAlgo !== nextJobAlgo) {
    const targetAlgo = controlFamily(app, "currPoolTargetAlgo", "currPoolTargetPending");
    const extraNonceAlgo = controlFamily(app, "currPoolExtraNonceAlgo", "currPoolExtraNoncePending");
    if (targetAlgo != null && targetAlgo !== nextJobAlgo) clearTarget(app);
    if (extraNonceAlgo != null && extraNonceAlgo !== nextJobAlgo) clearExtraNonce(app);
  }
  if (app.currPoolTargetPending) {
    app.currPoolTargetAlgo = nextJobAlgo;
    app.currPoolTargetPending = false;
  }
  if (app.currPoolExtraNoncePending) {
    app.currPoolExtraNonceAlgo = nextJobAlgo;
    app.currPoolExtraNoncePending = false;
  }
  app.currPoolJobAlgo = nextJobAlgo;
}

function recordPoolMessage(app, json) {
  let nextJobAlgo = null;
  if ("method" in json) {
    if (json.method === "job") {
      const params = json.params && typeof json.params === "object" ? json.params : {};
      nextJobAlgo = normalizePoolAlgo(params.algo || DEFAULT_ALGO, params);
      rememberJob(app, params, nextJobAlgo);
    } else if (json.method === "mining.notify") {
      nextJobAlgo = normalizePoolAlgo(json.algo || (json.params && json.params.algo) || DEFAULT_ALGO, json.params);
      rememberJob(app, json.params || [], nextJobAlgo);
    } else if (json.method === "mining.set_target" || json.method === "mining.set_difficulty") {
      rememberTarget(app, json);
    } else if (json.method === "mining.set_extranonce" || json.method === "set_extranonce") {
      rememberExtraNonce(app, json);
    }
  } else if (json.result && typeof json.result === "object" && "id" in json.result) {
    app.currPoolMinerId = json.result.id;
    if (json.id === 1) app.currPoolLoginResult = Object.assign({}, json.result);
    if (json.result.job) {
      nextJobAlgo = normalizePoolAlgo(json.result.job.algo || DEFAULT_ALGO, json.result.job);
      rememberJob(app, json.result.job, nextJobAlgo);
    } else if (json.id === 1 && json.result.algo) {
      nextJobAlgo = normalizePoolAlgo(json.result.algo, json.result);
      rememberPoolAlgo(app, nextJobAlgo);
    }
  }
  return nextJobAlgo;
}

function forwardGrinPoolMessage(app, json) {
  const grinJson = Object.assign({}, json);
  if (grinJson.result && grinJson.result.status === "OK") {
    grinJson.method = "submit";
    grinJson.result = "ok";
  }
  app.minerServer.write(app.minerServer.socket, stringifyLine(grinJson));
}

module.exports = {
  forwardGrinPoolMessage,
  recordPoolMessage,
};
