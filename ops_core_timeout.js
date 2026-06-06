#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_GRACE_SECONDS = 0.5;

function readTemplate(missionTemplatePath) {
  if (!fs.existsSync(missionTemplatePath)) {
    throw new Error(`Mission template not found: ${missionTemplatePath}`);
  }
  return JSON.parse(fs.readFileSync(missionTemplatePath, 'utf8'));
}

function sanitizeFilePart(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

class TimeoutMission {
  constructor(missionTemplatePath, { evidenceDir, now } = {}) {
    this.template = readTemplate(missionTemplatePath);
    this.now = typeof now === 'function' ? now : () => Date.now() / 1000;
    this.evidenceDir = evidenceDir || path.join(__dirname, 'tests', 'ops_evidence');

    this.state = 'INIT';
    this.reason = null;
    this.startTime = null;
    this.deadline = null;

    this.missionId = String(
      this.template.mission_id
      || this.template.id
      || `mission_${Math.floor(Date.now())}`,
    );
    this.timeoutSeconds = Number.isFinite(Number(this.template.timeoutSeconds))
      ? Number(this.template.timeoutSeconds)
      : DEFAULT_TIMEOUT_SECONDS;
    this.gracePeriod = Number.isFinite(Number(this.template.gracePeriod))
      ? Number(this.template.gracePeriod)
      : DEFAULT_GRACE_SECONDS;
  }

  start() {
    if (this.state !== 'INIT') {
      throw new Error(`Cannot start mission from state ${this.state}`);
    }

    this.startTime = this.now();
    this.deadline = this.startTime + Math.max(0, this.timeoutSeconds) + Math.max(0, this.gracePeriod);
    this.state = 'ACTIVE';
    return this;
  }

  tick(currentTimeSec = this.now()) {
    if (this.state !== 'ACTIVE') return this.state;

    if (currentTimeSec >= this.deadline) {
      this.state = 'FAILSAFE_TIMEOUT';
      this.reason = 'mission_timeout_failsafe';
      this.writeEvidence(currentTimeSec);
    }

    return this.state;
  }

  writeEvidence(triggerTime = this.now()) {
    fs.mkdirSync(this.evidenceDir, { recursive: true });
    const payload = {
      mission_id: this.missionId,
      timeoutSeconds: this.timeoutSeconds,
      gracePeriod: this.gracePeriod,
      start_time: this.startTime,
      deadline: this.deadline,
      trigger_time: triggerTime,
      final_state: this.state,
      reason: this.reason,
      template: String(this.template.name || 'unknown'),
    };
    const fileName = `timeout_${sanitizeFilePart(this.missionId)}.json`;
    const outputPath = path.join(this.evidenceDir, fileName);
    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
    return outputPath;
  }

  simulate(durationSeconds, intervalMs = 100) {
    if (!Number.isFinite(Number(durationSeconds)) || Number(durationSeconds) < 0) {
      throw new Error('durationSeconds must be a non-negative number');
    }

    this.start();
    const duration = Number(durationSeconds);

    const interval = setInterval(() => {
      const nowSec = this.now();
      const state = this.tick(nowSec);
      if (state !== 'ACTIVE' || nowSec - this.startTime >= duration) {
        clearInterval(interval);
      }
    }, intervalMs);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node ops_core_timeout.js <mission_template.json> [duration_seconds]');
    process.exit(1);
  }

  const missionPath = path.resolve(args[0]);
  const duration = args[1] ? Number(args[1]) : null;
  const mission = new TimeoutMission(missionPath);

  if (duration !== null && Number.isFinite(duration)) {
    mission.simulate(duration);
    return;
  }

  mission.start();
  const timer = setInterval(() => {
    const state = mission.tick();
    if (state !== 'ACTIVE') {
      clearInterval(timer);
      process.exit(0);
    }
  }, 100);
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_GRACE_SECONDS,
  DEFAULT_TIMEOUT_SECONDS,
  TimeoutMission,
};
