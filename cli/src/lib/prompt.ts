import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/** Ask a question on the terminal. Returns the trimmed answer. */
export function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Ask for a secret without echoing the typed characters. */
export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const mutedOutput = new Writable({
      write(chunk: Buffer | string, _enc, cb) {
        if (!muted) process.stdout.write(chunk);
        cb();
      },
    });
    const rl = createInterface({ input: process.stdin, output: mutedOutput, terminal: true });
    rl.question(question, (answer) => {
      muted = false;
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = true;
  });
}

/** Validate a bare domain name (e.g. example.com, blog.example.co.uk). */
export function isValidDomain(domain: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
    domain,
  );
}

/** Build the tracking snippet for a site. */
export function trackingSnippet(apiUrl: string, site: string): string {
  const base = apiUrl.replace(/\/$/, '');
  return `<script defer id="analytics" data-site-id="${site}" src="${base}/tracker.js"></script>`;
}
