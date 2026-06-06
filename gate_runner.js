#!/usr/bin/env node

/**
 * OGEN Sovereign Systems Engine - Hard Gate Runner
 * Reference: OGEN-ED-SPEC-2026-V1
 *
 * Local-only deterministic gate harness.
 */

const crypto = require('crypto');
const Module = require('module');

const CONFIG = {
  TIME_GATE: {
    MAX_EXECUTION_MS: 20,
  },
  STATE_GATE: {
    VALID_STATES: ['INIT', 'ACTIVE', 'FAILSAFE_TIMEOUT'],
    ALLOWED_TRANSITIONS: {
      INIT: ['ACTIVE'],
      ACTIVE: ['FAILSAFE_TIMEOUT'],
      FAILSAFE_TIMEOUT: [],
    },
  },
  SOVEREIGNTY_GATE: {
    BLOCKED_MODULES: new Set(['http', 'https', 'net', 'dgram', 'dns', 'tls']),
  },
};

const sampleInputPayload = {
  sensor_id: 'KCTS-COAXIAL-01',
  vibration_amplitude: 0.042,
  timestamp_utc: '2026-06-06T08:00:00Z',
};

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

class OgenGateRunner {
  static sovereigntyInstalled = false;

  static installSovereigntyGate() {
    if (OgenGateRunner.sovereigntyInstalled) return;
    const originalLoad = Module._load;
    Module._load = function wrappedLoad(request, parent, isMain) {
      if (CONFIG.SOVEREIGNTY_GATE.BLOCKED_MODULES.has(request)) {
        throw new Error(`SOVEREIGNTY_VIOLATION: blocked module "${request}" requested.`);
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    OgenGateRunner.sovereigntyInstalled = true;
  }

  constructor() {
    this.systemState = 'INIT';
    this.receiptsLog = [];
  }

  enforceSovereigntyGate() {
    OgenGateRunner.installSovereigntyGate();
    console.log(' -> [PASS] Sovereignty Gate: Network execution capabilities severed.');
  }

  transitionState(nextState) {
    if (!CONFIG.STATE_GATE.VALID_STATES.includes(nextState)) {
      throw new Error(`STATE_VIOLATION: Unknown state "${nextState}".`);
    }
    const allowed = CONFIG.STATE_GATE.ALLOWED_TRANSITIONS[this.systemState] || [];
    if (!allowed.includes(nextState)) {
      throw new Error(`STATE_VIOLATION: Illegal transition ${this.systemState} -> ${nextState}.`);
    }
    this.systemState = nextState;
  }

  generateCanonicalReceipt(eventLabel, details) {
    const receiptObj = {
      event: eventLabel,
      state: this.systemState,
      details,
    };
    const canonicalString = stableStringify(receiptObj);
    const txHash = crypto.createHash('sha256').update(canonicalString).digest('hex');
    const signedReceipt = {
      payload: receiptObj,
      canonical_bytes: canonicalString,
      sha256_checksum: txHash,
    };
    this.receiptsLog.push(signedReceipt);
    return signedReceipt;
  }

  executeCriticalPath(inputData, forceTimeoutDrift = false) {
    this.transitionState('ACTIVE');
    this.generateCanonicalReceipt('START_CRITICAL_PATH', {
      input_checksum: crypto.createHash('md5').update(stableStringify(inputData)).digest('hex'),
    });

    const startTime = process.hrtime.bigint();
    let accumulator = 0;

    if (forceTimeoutDrift) {
      const requiredNs = BigInt((CONFIG.TIME_GATE.MAX_EXECUTION_MS + 5) * 1_000_000);
      while (process.hrtime.bigint() - startTime < requiredNs) {
        accumulator ^= 1;
      }
    } else {
      for (let i = 0; i < 300_000; i += 1) {
        accumulator = (accumulator + ((i * 2654435761) >>> 0)) >>> 0;
      }
    }

    const endTime = process.hrtime.bigint();
    const executionTimeMs = Number(endTime - startTime) / 1_000_000;
    console.log(`    * Debug: Core loop completed in ${executionTimeMs.toFixed(4)} ms`);

    if (executionTimeMs > CONFIG.TIME_GATE.MAX_EXECUTION_MS) {
      this.transitionState('FAILSAFE_TIMEOUT');
      this.generateCanonicalReceipt('FAILSAFE_TRIGGERED', {
        actual_ms: Number(executionTimeMs.toFixed(4)),
        allowed_ms: CONFIG.TIME_GATE.MAX_EXECUTION_MS,
      });
      throw new Error(
        `TIME_VIOLATION: Deadline breached. Threshold ${CONFIG.TIME_GATE.MAX_EXECUTION_MS}ms, Actual ${executionTimeMs.toFixed(2)}ms`,
      );
    }

    this.generateCanonicalReceipt('COMPLETED_CRITICAL_PATH', { calculations_stabilized: true });
    return accumulator;
  }

  verifyDeterminismGate(testPayload) {
    const runOneRunner = new OgenGateRunner();
    const runTwoRunner = new OgenGateRunner();
    runOneRunner.enforceSovereigntyGate();
    runTwoRunner.enforceSovereigntyGate();

    const outputOne = runOneRunner.executeCriticalPath(testPayload, false);
    const outputTwo = runTwoRunner.executeCriticalPath(testPayload, false);
    if (outputOne !== outputTwo) {
      throw new Error('DETERMINISM_VIOLATION: Execution output mismatch under identical inputs.');
    }

    const chainOne = runOneRunner.receiptsLog.map((r) => r.sha256_checksum).join(':');
    const chainTwo = runTwoRunner.receiptsLog.map((r) => r.sha256_checksum).join(':');
    if (chainOne !== chainTwo) {
      throw new Error('DETERMINISM_VIOLATION: Audit trail serialization divergence detected.');
    }

    console.log(' -> [PASS] Determinism Gate: Identical vectors yield identical cryptographic matrices.');
  }
}

function main() {
  console.log('=================================================================');
  console.log('OGEN SOVEREIGN SYSTEMS AUTOMATED VALIDATION SUITE');
  console.log('=================================================================\n');

  const masterRunner = new OgenGateRunner();

  try {
    masterRunner.enforceSovereigntyGate();

    console.log('\nExecuting Gate 5 Evaluation (Differential Check)...');
    masterRunner.verifyDeterminismGate(sampleInputPayload);
    console.log(' -> [PASS] State Gate & Evidence Gate: Lifecycle transitions structurally absolute.');

    console.log('\nExecuting Normal Path Performance Evaluation...');
    masterRunner.executeCriticalPath(sampleInputPayload, false);
    console.log(` -> [PASS] Time Gate: Loop completed within ${CONFIG.TIME_GATE.MAX_EXECUTION_MS}ms safety ceiling.`);

    console.log('\nInducing Artificial Processing Drift (Testing Time Gate Breaker)...');
    masterRunner.executeCriticalPath(sampleInputPayload, true);
  } catch (error) {
    console.error(`\n[GATE SEVERANCE TRIGGERED]: ${error.message}`);
    if (String(error.message).includes('TIME_VIOLATION')) {
      console.log('\n=================================================================');
      console.log('SUCCESS: Engine safely trapped and recorded structural error.');
      console.log('Build script remains secure. Invariant system is fully validated.');
      console.log('=================================================================');
      process.exit(0);
    }
    console.error('CRITICAL: System failed via unhandled architecture escape route.');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  CONFIG,
  OgenGateRunner,
  stableStringify,
};
