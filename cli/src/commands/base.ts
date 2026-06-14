import { Command } from 'commander';
import { fetchApi, formatTable } from '../lib/api.js';

export function makeCommand(name: string, description: string): Command {
  const cmd = new Command(name);
  cmd
    .description(description)
    .requiredOption('-s, --site <site>', 'Site to query (e.g., example.com)')
    .option('-p, --period <period>', 'Time period (e.g., 7d, 30d)', '7d')
    .option('-l, --limit <limit>', 'Max results to return', '10')
    .option('--json', 'Output as JSON (default)', true)
    .option('--table', 'Output as human-readable table')
    .action(async (opts) => {
      try {
        const params: Record<string, string> = {
          site: opts.site,
          period: opts.period,
          limit: opts.limit,
        };

        // Add extra params from the command (type, unit)
        if (opts.type) params.type = opts.type;
        if (opts.unit) params.unit = opts.unit;
        if (opts.dimension) params.dimension = opts.dimension;
        if (opts.days) params.days = opts.days;
        if (opts.from) params.from = opts.from;
        if (opts.to) params.to = opts.to;

        const result = await fetchApi(name, params);

        if (opts.table) {
          const arr = Array.isArray(result.data) ? result.data : [result.data];
          console.log(formatTable(arr as Record<string, unknown>[]));
          if (result.meta.sampled) {
            console.log('\n(data may be sampled)');
          }
        } else {
          console.log(JSON.stringify(result, null, 2));
        }

        // Exit code 2 if no data
        const dataArr = Array.isArray(result.data) ? result.data : [result.data];
        const isEmpty = dataArr.length === 0 || (dataArr.length === 1 && Object.values(dataArr[0] as Record<string, unknown>).every((v) => v === 0 || v === null));
        if (isEmpty) process.exit(2);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  return cmd;
}
