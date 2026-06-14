import { Command } from 'commander';
import { fetchApi, formatTable } from '../lib/api.js';

export function activeCommand(): Command {
  const cmd = new Command('active');
  cmd
    .description('Current active visitors in the last N minutes')
    .requiredOption('-s, --site <site>', 'Site to query (e.g., example.com)')
    .option('-w, --window <minutes>', 'Active window in minutes, clamped server-side to 1-60', '5')
    .option('--json', 'Output as JSON (default)', true)
    .option('--table', 'Output as human-readable table')
    .action(async (opts) => {
      try {
        const result = await fetchApi('active', { site: opts.site, window: opts.window });
        if (opts.table) {
          console.log(formatTable([result.data as Record<string, unknown>]));
          if (result.meta.sampled) {
            console.log('\n(data may be sampled)');
          }
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  return cmd;
}
