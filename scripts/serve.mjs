// Production entry: runs the web app and the watcher side by side; restarts either if it exits.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

function run(name, cmd, args, cwd) {
  const start = () => {
    const p = spawn(cmd, args, { cwd, stdio: 'inherit', env: process.env, shell: isWin });
    p.on('exit', code => {
      console.error(`[serve] ${name} exited with ${code}; restarting in 5 s`);
      setTimeout(start, 5000);
    });
  };
  start();
}

run('web', 'npx', ['next', 'start', '-p', process.env.PORT ?? '3000'], path.join(root, 'app'));
if (process.env.WATCHER !== 'off') run('watcher', 'npx', ['tsx', 'scripts/watch.ts'], path.join(root, 'engine'));
