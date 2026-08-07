#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_BROWSERS = ['chromium', 'chromium-headless-shell'];
const DEFAULT_MIRROR_HOST = 'https://cdn.npmmirror.com/binaries/playwright';

function parseDryRunOutput(output) {
  const installDirs = new Map();
  let currentBrowser = null;
  for (const line of output.split('\n')) {
    const browserMatch = line.match(/\(playwright (\S+) v\d+\)/);
    if (browserMatch) {
      currentBrowser = browserMatch[1];
      continue;
    }
    if (currentBrowser) {
      const locationMatch = line.match(/Install location:\s*(\S+)/);
      if (locationMatch) {
        installDirs.set(currentBrowser, locationMatch[1]);
        currentBrowser = null;
      }
    }
  }
  return installDirs;
}

function isInstalled(installDir) {
  if (!installDir || !existsSync(installDir)) {
    return false;
  }
  try {
    return readdirSync(installDir).some((entry) => !entry.endsWith('.partial'));
  } catch {
    return false;
  }
}

function dryRunBrowsers() {
  const output = execFileSync('npx', ['playwright', 'install', '--dry-run'], {
    encoding: 'utf8',
  });
  return parseDryRunOutput(output);
}

function main() {
  let installDirs = dryRunBrowsers();
  const missing = REQUIRED_BROWSERS.filter((name) => !isInstalled(installDirs.get(name)));

  if (missing.length === 0) {
    const summary = REQUIRED_BROWSERS
      .map((name) => `${name}@${path.basename(installDirs.get(name))}`)
      .join(', ');
    console.log(`[test:setup] Playwright browsers ready: ${summary}`);
    return 0;
  }

  console.log(`[test:setup] missing Playwright browsers: ${missing.join(', ')}`);
  for (const name of missing) {
    const mirror = process.env.PLAYWRIGHT_DOWNLOAD_HOST || DEFAULT_MIRROR_HOST;
    console.log(`[test:setup] installing ${name} (mirror: ${mirror})`);
    execFileSync('npx', ['playwright', 'install', name], {
      stdio: 'inherit',
      env: {
        ...process.env,
        PLAYWRIGHT_DOWNLOAD_HOST: mirror,
      },
    });
    installDirs = dryRunBrowsers();
    if (!isInstalled(installDirs.get(name))) {
      throw new Error(`[test:setup] ${name} is still missing after install.`);
    }
  }

  console.log('[test:setup] Playwright browsers ready.');
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
