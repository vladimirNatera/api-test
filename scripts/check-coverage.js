const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const metrics = ['statements', 'branches', 'functions', 'lines'];
const baselinePath = path.join(__dirname, '..', 'coverage-baseline.json');
const summaryPath = path.join(__dirname, '..', 'coverage', 'coverage-summary.json');

function readJson(filename) {
  return JSON.parse(readFileSync(filename, 'utf8'));
}

function check() {
  const report = readJson(summaryPath).total;
  const current = Object.fromEntries(metrics.map((metric) => [metric, report[metric].pct]));
  const baseline = readJson(baselinePath);
  const floors = [baseline];
  if (process.env.COVERAGE_BASELINE_PATH) {
    floors.push(readJson(process.env.COVERAGE_BASELINE_PATH));
  }
  for (const floor of floors) {
    for (const metric of metrics) {
      if (!Number.isFinite(current[metric]) || !Number.isFinite(floor[metric])
          || current[metric] < floor[metric]) {
        throw new Error(`Coverage decreased: ${metric} ${current[metric]}%, required ${floor[metric]}%`);
      }
    }
  }
  if (process.argv.includes('--update')) {
    writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    console.log('Coverage baseline increased to the current results');
    return;
  }
  if (metrics.some((metric) => current[metric] !== baseline[metric])) {
    throw new Error('Coverage improved. Run npm run coverage:update and commit coverage-baseline.json');
  }
  console.log(`Coverage gate passed: ${JSON.stringify(current)}`);
}

try {
  check();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
