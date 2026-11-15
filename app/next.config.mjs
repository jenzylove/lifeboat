import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Local dev convenience: load the repo root .env (server only) for keys not already set.
// Values never reach client bundles: nothing here is copied into `env` or NEXT_PUBLIC_*.
for (const f of [path.join(here, '..', '.env')]) {
  try {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {}
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { externalDir: true },
  outputFileTracingRoot: path.join(here, '..'),
  webpack(config) {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] };
    return config;
  },
};
export default nextConfig;
