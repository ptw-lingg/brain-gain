// Full pipeline for the BrainGain self-trainings:
//   render  → decks/*.html → out/*.pdf              (so the viewer screenshot shows real slides)
//   capture → isolated instance → shots/*.png        (skipped with --skip-capture)
//   render  → final PDFs with the fresh screenshots
//   install → backend/src/data (skipped with --no-install; --data/--owner pass through)
//
//   node tools/self-training/build.mjs [--skip-capture] [--no-build] [--no-install] [--data <dir>] [--owner <email>]

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const run = (script, args = []) => {
  const r = spawnSync(process.execPath, [join(here, script), ...args], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('render.mjs');
if (!argv.includes('--skip-capture')) run('capture.mjs', argv.includes('--no-build') ? ['--no-build'] : []);
run('render.mjs');
if (!argv.includes('--no-install')) {
  const pass = [];
  for (const flag of ['--data', '--owner']) {
    if (argv.includes(flag)) pass.push(flag, argv[argv.indexOf(flag) + 1]);
  }
  run('install.mjs', pass);
}
