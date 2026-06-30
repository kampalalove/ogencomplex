import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

type Status = 'PASS' | 'FAIL';

interface DiagnosticResult {
  name: string;
  status: Status;
  message: string;
  target?: string;
}

interface ProjectConfig {
  requiredFiles: string[];
  requiredEnvVars: string[];
  maxFileSizeMB: number;
  allowedNodeVersions: string[];
  ignorePatterns?: string[];
  customChecks?: { name: string; script: string }[];
}

class FixCord {
  private results: DiagnosticResult[] = [];
  private config: ProjectConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  run(targetPath: string): number {
    this.checkRequiredFiles(targetPath);
    this.checkEnvVars();
    this.checkNodeVersion();
    this.checkFileSizes(targetPath);
    this.runCustomChecks();

    this.writeAuditTrail(this.results);

    const failures = this.results.filter(r => r.status === 'FAIL').length;
    return failures === 0 ? 0 : 1;
  }

  private loadConfig(): ProjectConfig {
    const configPath = path.resolve('.fixcordrc.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    return {
      requiredFiles: ['package.json', 'tsconfig.json'],
      requiredEnvVars: ['NODE_ENV'],
      maxFileSizeMB: 10,
      allowedNodeVersions: ['v18', 'v20', 'v22']
    };
  }

  private addResult(name: string, status: Status, message: string, target?: string) {
    this.results.push({ name, status, message, target });
  }

  private checkRequiredFiles(root: string) {
    for (const file of this.config.requiredFiles) {
      const full = path.join(root, file);
      if (fs.existsSync(full)) {
        this.addResult('RequiredFile', 'PASS', 'Found ' + file, full);
      } else {
        this.addResult('RequiredFile', 'FAIL', 'Missing ' + file, full);
      }
    }
  }

  private checkEnvVars() {
    for (const env of this.config.requiredEnvVars) {
      if (process.env[env]) {
        this.addResult('EnvVar', 'PASS', 'Env ' + env + ' present');
      } else {
        this.addResult('EnvVar', 'FAIL', 'Env ' + env + ' missing');
      }
    }
  }

  private checkNodeVersion() {
    const version = process.version;
    const ok = this.config.allowedNodeVersions.some(v => version.startsWith(v));
    if (ok) {
      this.addResult('NodeVersion', 'PASS', 'Node version ' + version + ' allowed');
    } else {
      this.addResult('NodeVersion', 'FAIL', 'Node version ' + version + ' not allowed');
    }
  }

  private checkFileSizes(root: string) {
    const maxBytes = this.config.maxFileSizeMB * 1024 * 1024;
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
        } else {
          const stat = fs.statSync(full);
          if (stat.size > maxBytes) {
            this.addResult('FileSize', 'FAIL', 'File too large: ' + full, full);
          }
        }
      }
    };
    walk(root);
  }

  private runCustomChecks() {
    if (!this.config.customChecks) return;
    for (const check of this.config.customChecks) {
      try {
        const res = require('child_process').spawnSync('bash', ['-lc', check.script], {
          stdio: 'inherit'
        });
        if (res.status === 0) {
          this.addResult(check.name, 'PASS', 'Custom check passed: ' + check.script);
        } else {
          this.addResult(check.name, 'FAIL', 'Custom check failed: ' + check.script);
        }
      } catch (e: any) {
        this.addResult(check.name, 'FAIL', 'Custom check error: ' + e.message);
      }
    }
  }

  generateURPSeal(targetPath: string): string {
    const hash = crypto.createHash('sha256');
    const files = ['package.json', 'tsconfig.json'];
    for (const f of files) {
      const full = path.join(targetPath, f);
      if (fs.existsSync(full)) {
        hash.update(fs.readFileSync(full));
      }
    }
    hash.update(process.env.GITHUB_SHA || 'local');
    return hash.digest('hex');
  }

  writeAuditTrail(results: DiagnosticResult[]): void {
    const audit = {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      checks: results,
      summary: {
        total: results.length,
        passed: results.filter(r => r.status === 'PASS').length,
        failed: results.filter(r => r.status === 'FAIL').length
      }
    };
    fs.writeFileSync('.fixcord-audit.json', JSON.stringify(audit, null, 2));
  }

  toJSON(targetPath: string) {
    const failures = this.results.filter(r => r.status === 'FAIL').length;
    return {
      status: failures === 0 ? 'PASS' : 'FAIL',
      results: this.results,
      urp_seal: failures === 0 ? this.generateURPSeal(targetPath) : null
    };
  }
}

const args = process.argv.slice(2);
const target = args[0] || '.';
const jsonMode = args.includes('--json');

const fixCord = new FixCord();
const code = fixCord.run(target);

if (jsonMode) {
  console.log(JSON.stringify(fixCord.toJSON(target)));
  process.exit(code);
} else {
  console.log('FixCord status: ' + (code === 0 ? 'PASS' : 'FAIL'));
  process.exit(code);
}
