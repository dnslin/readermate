const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const root = path.resolve(__dirname, '..');
  let executable = process.env.VSCODE_EXECUTABLE_PATH;
  if (!executable && process.platform === 'win32') {
    const cli = execFileSync('where.exe', ['code'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    executable = path.resolve(path.dirname(cli), '..', 'Code.exe');
    if (!fs.existsSync(executable)) throw new Error(`VS Code executable not found: ${executable}`);
  }
  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, 'extension-host', 'smoke.cjs'),
    launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes', '--remote-debugging-port=19472'],
    extensionTestsEnv: { READERMATE_SMOKE_VISUAL: process.env.READERMATE_SMOKE_VISUAL || (process.argv.includes('--visual') ? '1' : '') },
  });
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
