import { spawn } from 'node:child_process';

// On Windows npx is a .cmd shim that spawn() can't execute directly.
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

export interface WranglerEnv {
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
}

function wranglerProcessEnv(env: WranglerEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
    // Keep wrangler non-interactive and quiet about updates/telemetry prompts
    WRANGLER_SEND_METRICS: 'false',
  };
}

/**
 * Run `npx wrangler@4 deploy` in `cwd`, streaming output to the terminal
 * (stderr, so stdout stays clean for JSON) while capturing stdout so the
 * workers.dev URL can be parsed.
 */
export function wranglerDeploy(cwd: string, env: WranglerEnv): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(NPX, ['wrangler@4', 'deploy'], {
      cwd,
      env: wranglerProcessEnv(env),
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`wrangler deploy exited with code ${code}`));
    });
  });
}

/**
 * Run `npx wrangler@4 secret put <name>` in `cwd`, piping the secret value
 * via stdin. The value is never echoed or logged.
 */
export function wranglerSecretPut(
  cwd: string,
  env: WranglerEnv,
  name: string,
  value: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(NPX, ['wrangler@4', 'secret', 'put', name], {
      cwd,
      env: wranglerProcessEnv(env),
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.stdin.write(value + '\n');
    child.stdin.end();
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`wrangler secret put ${name} exited with code ${code}`));
    });
  });
}

/** Parse the workers.dev URL from wrangler deploy output. Returns null if absent. */
export function parseWorkersDevUrl(deployOutput: string): string | null {
  const match = deployOutput.match(/https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev/i);
  return match ? match[0] : null;
}
