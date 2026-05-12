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

JSON.parse(read('capacitor.config.json'));
for (const file of [
  'assets/icon/play-store-icon.png',
  'assets/icon/feature-graphic.png',
  'assets/android/drawable/ic_launcher.xml',
  'docs/privacy-policy.html',
  'play/README.md',
  'play/data-safety.md',
]) {
  if (!fs.existsSync(rel(file))) fail(`Missing ${file}`);
}

const html = read('www/index.html');
for (const required of ['Content-Security-Policy', 'app.js', 'historySearch', 'privacy', 'stars']) {
  if (!html.includes(required)) fail(`www/index.html misses ${required}`);
}
for (const blocked of ['update-btn', 'build-info.js', 'class="mic"', 'data-target=']) {
  if (html.includes(blocked)) fail(`www/index.html must not contain ${blocked}`);
}
if (!html.includes("connect-src 'none'")) fail('CSP must block network connections');

const app = read('www/app.js');
for (const required of ['renderHistoryStats', 'LocalNotifications', 'localStorage']) {
  if (!app.includes(required)) fail(`www/app.js misses ${required}`);
}
for (const blocked of ['fetch(', 'SpeechRecognition', 'Browser', 'window.open', 'BUILD_SHA']) {
  if (app.includes(blocked)) fail(`www/app.js must not contain ${blocked}`);
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
for (const required of ['npm run check', 'scripts/patch-android-ci.sh', 'bundleRelease', 'dnevnik-play.aab']) {
  if (!workflow.includes(required)) fail(`build.yml misses ${required}`);
}

const packageJson = JSON.parse(read('package.json'));
for (const blocked of ['@capacitor/browser', '@capacitor-community/speech-recognition']) {
  if (packageJson.dependencies?.[blocked] || packageJson.devDependencies?.[blocked]) {
    fail(`package.json must not depend on ${blocked}`);
  }
}

console.log('Checks passed');
