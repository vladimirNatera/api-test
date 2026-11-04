const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

describe('coverage quality gate', () => {
  let directory;
  const baseline = { statements: 98, branches: 95, functions: 100, lines: 98 };

  function writeReport(metrics) {
    const total = Object.fromEntries(Object.entries(metrics).map(([metric, pct]) => [metric, { pct }]));
    writeFileSync(path.join(directory, 'coverage/coverage-summary.json'), JSON.stringify({ total }));
  }

  function run(argumentsList = [], environment = {}) {
    return spawnSync(process.execPath, [path.join(directory, 'scripts/check-coverage.js'), ...argumentsList], {
      encoding: 'utf8', env: { ...process.env, COVERAGE_BASELINE_PATH: '', ...environment },
    });
  }

  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'checkout-coverage-'));
    mkdirSync(path.join(directory, 'scripts'));
    mkdirSync(path.join(directory, 'coverage'));
    copyFileSync(path.join(__dirname, '../../scripts/check-coverage.js'), path.join(directory, 'scripts/check-coverage.js'));
    writeFileSync(path.join(directory, 'coverage-baseline.json'), JSON.stringify(baseline));
    writeReport(baseline);
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  test('accepts unchanged coverage', () => {
    expect(run().status).toBe(0);
  });

  test.each(['statements', 'branches', 'functions', 'lines'])('rejects a decrease in %s, including during updates', (metric) => {
    writeReport({ ...baseline, [metric]: baseline[metric] - 0.01 });
    expect(run().status).toBe(1);
    expect(run(['--update']).status).toBe(1);
  });

  test('requires improved coverage to be recorded, then accepts the new baseline', () => {
    const improved = { ...baseline, branches: 96 };
    writeReport(improved);
    expect(run().status).toBe(1);
    expect(run(['--update']).status).toBe(0);
    expect(JSON.parse(readFileSync(path.join(directory, 'coverage-baseline.json'), 'utf8'))).toEqual(improved);
    expect(run().status).toBe(0);
  });

  test('cannot bypass the target branch baseline by lowering the local baseline', () => {
    const external = path.join(directory, 'target-coverage.json');
    writeFileSync(external, JSON.stringify({ ...baseline, branches: 96 }));
    const result = run([], { COVERAGE_BASELINE_PATH: external });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Coverage decreased: branches');
  });

  test('fails closed for an invalid baseline or missing report', () => {
    writeFileSync(path.join(directory, 'coverage-baseline.json'), '{}');
    expect(run().status).toBe(1);
    rmSync(path.join(directory, 'coverage/coverage-summary.json'));
    expect(run().status).toBe(1);
  });
});
