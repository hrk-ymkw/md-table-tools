'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-table-tools-test-'));
const executable = process.env.VSCODE_BIN || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe') : 'code');
const vsixMode = process.argv[2] === '--vsix';
const extensionsDir = path.join(temp, 'extensions');
if (vsixMode) {
  const vsix = path.resolve(process.argv[3] || 'extension.vsix');
  if (!fs.existsSync(vsix)) throw new Error(`VSIX not found: ${vsix}`);
  const installArgs = ['--install-extension', vsix, '--user-data-dir', path.join(temp, 'user'), '--extensions-dir', extensionsDir, '--force'];
  let install;
  if (process.platform === 'win32') {
    const cli = path.join(path.dirname(executable), 'bin', 'code.cmd');
    const command = [cli, ...installArgs].map((arg) => `"${arg}"`).join(' ');
    install = spawnSync(process.env.ComSpec, ['/d', '/s', '/c', `"${command}"`], {
      stdio: 'inherit', timeout: 120000, windowsVerbatimArguments: true,
    });
  } else {
    install = spawnSync(executable, installArgs, { stdio: 'inherit', timeout: 120000 });
  }
  if (install.error || install.status !== 0) throw install.error || new Error('VSIX installation failed');
}
const args = [
  `--locale=${process.env.MDT_TEST_LOCALE || 'en'}`, '--disable-gpu', '--no-sandbox', '--skip-welcome', '--skip-release-notes', '--new-window', '--wait',
  `--user-data-dir=${path.join(temp, 'user')}`, `--extensions-dir=${extensionsDir}`,
  `--extensionDevelopmentPath=${vsixMode ? path.join(__dirname, 'host-extension') : root}`,
  `--extensionTestsPath=${path.join(__dirname, 'integration')}`,
];
const resultFile = path.join(temp, 'result.json');
const result = spawnSync(executable, args, {
  stdio: 'inherit', timeout: 120000,
  env: { ...process.env, MDT_TEST_RESULT: resultFile },
});
if (result.error) console.error(result.error.message);
if (!fs.existsSync(resultFile)) {
  console.error('VS Code did not report integration test results.');
  process.exit(1);
}
const results = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
process.exit(result.status === 0 && results.length > 0 && results.every((r) => r.startsWith('PASS ')) ? 0 : 1);
