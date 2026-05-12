const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const rel = (...parts) => path.join(root, ...parts);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed`);
  }
}

function read(file) {
  return fs.readFileSync(rel(file), 'utf8');
}

run(process.execPath, ['--check', rel('www', 'app.js')]);

JSON.parse(read('www/version.json'));
JSON.parse(read('capacitor.config.json'));

const html = read('www/index.html');
for (const required of ['build-info.js', 'app.js', 'historySearch', 'stars']) {
  if (!html.includes(required)) fail(`www/index.html misses ${required}`);
}

const app = read('www/app.js');
for (const required of ['VERSION_URL', 'Browser?.open', 'renderHistoryStats']) {
  if (!app.includes(required)) fail(`www/app.js misses ${required}`);
}

const htmlIds = new Set([...html.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]));
const jsIds = new Set(
  [...app.matchAll(/\$\('([^']+)'\)|getElementById\('([^']+)'\)/g)]
    .map((match) => match[1] || match[2])
);
for (const id of jsIds) {
  if (!htmlIds.has(id)) fail(`www/app.js references missing DOM id: ${id}`);
}

const workflow = read('.github/workflows/build.yml');
for (const required of ['npm run check', 'scripts/patch-android-ci.sh', 'version.json']) {
  if (!workflow.includes(required)) fail(`build.yml misses ${required}`);
}

console.log('Checks passed');
