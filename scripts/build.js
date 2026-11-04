const { readdirSync } = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

for (const directory of ['src', 'scripts']) {
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', path.join(directory, file)], { stdio: 'inherit' });
  }
}
console.log('JavaScript build validation passed');
