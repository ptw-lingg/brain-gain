// The SCORM API shim — the object a SCO finds as window.API (1.2) or window.API_1484_11 (2004) on
// the wrapper frame. Served verbatim by the content origin at /s/<token>/_lms/scorm-api.js.
//
// Every call is SYNCHRONOUS (the SCORM contract): reads answer from a local model seeded before
// the SCO exists; writes update the model, mark keys dirty and return "true" immediately. Flushes
// (Commit/Finish/pagehide) hand the dirty diff to the wrapper, which posts it to the app —
// fire-and-forget, NEVER blocking: a spin-wait freezes the course and the browser kills the tab.
// The server re-validates everything; this copy of the rules exists only to return the right
// SCORM error code on the same tick (Captivate's strict mode checks them).
//
// Simplified TWIN of backend/src/scorm/model.ts — the server's verdict is authoritative.

(function () {
  'use strict';

  var VALUE_MAX = 65536; // matches CMI_MAX_VALUE_LEN in scorm/protocol.ts
  var model = Object.create(null);
  var readOnly = Object.create(null);
  var version = '1.2';
  var dirty = Object.create(null);
  var unacked = {}; // seq → values object, resent merged into the next flush
  var lastError = '0';
  var initialized = false;
  var terminated = false;

  var ERRORS_12 = {
    0: 'No error', 101: 'General exception', 201: 'Invalid argument error',
    202: 'Element cannot have children', 203: 'Element not an array — cannot have count',
    301: 'Not initialized', 401: 'Not implemented error', 402: 'Invalid set value, element is a keyword',
    403: 'Element is read only', 404: 'Element is write only', 405: 'Incorrect data type',
  };
  var ERRORS_2004 = {
    0: 'No Error', 101: 'General Exception', 102: 'General Initialization Failure',
    103: 'Already Initialized', 104: 'Content Instance Terminated', 111: 'General Termination Failure',
    112: 'Termination Before Initialization', 113: 'Termination After Termination',
    122: 'Retrieve Data Before Initialization', 123: 'Retrieve Data After Termination',
    132: 'Store Data Before Initialization', 133: 'Store Data After Termination',
    142: 'Commit Before Initialization', 143: 'Commit After Termination',
    201: 'General Argument Error', 301: 'General Get Failure', 351: 'General Set Failure',
    391: 'General Commit Failure', 401: 'Undefined Data Model Element',
    402: 'Unimplemented Data Model Element', 403: 'Data Model Element Value Not Initialized',
    404: 'Data Model Element Is Read Only', 405: 'Data Model Element Is Write Only',
    406: 'Data Model Element Type Mismatch', 407: 'Data Model Element Value Out Of Range',
    408: 'Data Model Dependency Not Established',
  };

  var LESSON_STATUS_12 = ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'];
  var COMPLETION_2004 = ['completed', 'incomplete', 'not attempted', 'unknown'];
  var SUCCESS_2004 = ['passed', 'failed', 'unknown'];

  function countOf(prefix) {
    var max = -1;
    for (var key in model) {
      if (key.indexOf(prefix + '.') === 0) {
        var rest = key.slice(prefix.length + 1);
        var n = parseInt(rest, 10);
        if (!isNaN(n) && n > max && /^\d+\./.test(rest)) max = n;
      }
    }
    return max + 1;
  }

  function getValue(key) {
    if (!initialized) { lastError = version === '1.2' ? '301' : '122'; return ''; }
    if (/\.(interactions|objectives)\._count$/.test(key)) {
      lastError = '0';
      return String(countOf(key.replace(/\._count$/, '')));
    }
    if (key in model) { lastError = '0'; return String(model[key]); }
    // Unknown element: "" + error 401 — NEVER throw; Captivate's strict mode probes elements and
    // treats a thrown error (unlike a returned code) as fatal.
    lastError = '401';
    return '';
  }

  function setValue(key, value) {
    if (!initialized) { lastError = version === '1.2' ? '301' : '132'; return 'false'; }
    if (terminated) { lastError = version === '1.2' ? '101' : '133'; return 'false'; }
    key = String(key);
    value = String(value);
    if (readOnly[key] || /\._(children|count)$/.test(key) || key === 'cmi._version') {
      lastError = version === '1.2' ? '403' : '404';
      return 'false';
    }
    if (value.length > VALUE_MAX) {
      // Over-cap is REJECTED, never truncated — a truncated suspend_data breaks resume worse
      // than a failed save the course can see and retry.
      lastError = version === '1.2' ? '405' : '351';
      return 'false';
    }
    if (version === '1.2' && key === 'cmi.core.lesson_status' && LESSON_STATUS_12.indexOf(value) === -1) {
      lastError = '405';
      return 'false';
    }
    if (version === '2004' && key === 'cmi.completion_status' && COMPLETION_2004.indexOf(value) === -1) {
      lastError = '406';
      return 'false';
    }
    if (version === '2004' && key === 'cmi.success_status' && SUCCESS_2004.indexOf(value) === -1) {
      lastError = '406';
      return 'false';
    }
    model[key] = value;
    dirty[key] = true;
    lastError = '0';
    scheduleFlush();
    return 'true';
  }

  // Writes coalesce for 200 ms so chatty courses (Captivate sets values on every slide change)
  // become a few bridge messages, not hundreds.
  var flushTimer = null;
  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(function () { flush('set'); }, 200);
  }

  function collectDirty() {
    var values = {};
    var any = false;
    // Un-acked earlier batches ride along (resend), newest value wins per key.
    for (var s in unacked) {
      var old = unacked[s];
      for (var k1 in old) { values[k1] = old[k1]; any = true; }
      delete unacked[s];
    }
    for (var k2 in dirty) { values[k2] = model[k2]; any = true; }
    dirty = Object.create(null);
    return any ? values : null;
  }

  function flush(kind, exit) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    var values = collectDirty();
    if (!values && kind === 'set') return;
    var sentSeq = shim.onFlush(kind, values || {}, exit);
    if (values) unacked[sentSeq] = values;
    // Bound the resend buffer: a dead bridge must not grow memory without limit.
    var seqs = Object.keys(unacked);
    if (seqs.length > 20) {
      // eslint-disable-next-line no-console
      console.warn('scorm-shim: dropping oldest unacked batch (bridge not acking)');
      delete unacked[seqs[0]];
    }
  }

  function commit() {
    if (!initialized) { lastError = version === '1.2' ? '301' : '142'; return 'false'; }
    flush('commit');
    lastError = '0';
    return 'true'; // optimistic — a nak surfaces as error 101 on the NEXT call, which SCORM permits
  }

  function finish() {
    if (!initialized) { lastError = version === '1.2' ? '301' : '112'; return 'false'; }
    if (terminated) { lastError = version === '1.2' ? '101' : '113'; return 'false'; }
    terminated = true;
    flush('terminate', String(model[version === '1.2' ? 'cmi.core.exit' : 'cmi.exit'] || ''));
    lastError = '0';
    return 'true';
  }

  var shim = {
    // wired by the wrapper: (kind, values, exit) → the bridge seq the batch went out under
    onFlush: function () { return 0; },
    flush: flush,
    seed: function (cmi, ver, readOnlyKeys) {
      version = ver;
      model = Object.create(null);
      for (var k in cmi) if (Object.prototype.hasOwnProperty.call(cmi, k)) model[k] = cmi[k];
      readOnly = Object.create(null);
      for (var i = 0; i < readOnlyKeys.length; i++) readOnly[readOnlyKeys[i]] = true;
    },
    onAck: function (forSeq) { delete unacked[forSeq]; },
    onNak: function (forSeq) { lastError = '101'; void forSeq; /* batch stays in unacked → resent */ },
    api12: {
      LMSInitialize: function () {
        if (initialized) { lastError = '101'; return 'false'; }
        initialized = true; lastError = '0';
        shim.onFlush('initialize', {});
        return 'true';
      },
      LMSFinish: function () { return finish(); },
      LMSGetValue: getValue,
      LMSSetValue: setValue,
      LMSCommit: commit,
      LMSGetLastError: function () { return lastError; },
      LMSGetErrorString: function (code) { return ERRORS_12[Number(code)] || ''; },
      LMSGetDiagnostic: function (code) { return ERRORS_12[Number(code)] || String(code || lastError); },
    },
    api2004: {
      Initialize: function () {
        if (initialized) { lastError = '103'; return 'false'; }
        initialized = true; lastError = '0';
        shim.onFlush('initialize', {});
        return 'true';
      },
      Terminate: function () { return finish(); },
      GetValue: getValue,
      SetValue: setValue,
      Commit: commit,
      GetLastError: function () { return lastError; },
      GetErrorString: function (code) { return ERRORS_2004[Number(code)] || ''; },
      GetDiagnostic: function (code) { return ERRORS_2004[Number(code)] || String(code || lastError); },
    },
  };

  window.__scormShim = shim;
})();
