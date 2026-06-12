import { Command } from 'commander';
import { fetchSites, getApiConfig } from '../lib/api.js';
import { loadEnv } from '../lib/env.js';
import { isValidDomain, trackingSnippet } from '../lib/prompt.js';

export function snippetCommand(): Command {
  const cmd = new Command('snippet');
  cmd
    .description('Print the tracking <script> snippet for one site, or all tracked sites')
    .option('-s, --site <site>', 'Site to print the snippet for')
    .action(async (opts) => {
      loadEnv();
      const apiUrl = process.env.ANALYTICS_API_URL;
      if (!apiUrl) {
        console.error('Error: ANALYTICS_API_URL is required. Run "lazyanalytics setup" first.');
        process.exit(3);
      }

      if (opts.site) {
        const site = String(opts.site).trim().toLowerCase();
        if (!isValidDomain(site)) {
          console.error(`Error: invalid domain "${opts.site}" (expected e.g. example.com)`);
          process.exit(1);
        }
        console.log(trackingSnippet(apiUrl, site));
        return;
      }

      // No --site: list every tracked site from the worker.
      const config = getApiConfig();
      let sites: string[] = [];
      if (config) {
        try {
          sites = await fetchSites(config);
        } catch {
          sites = [];
        }
      }
      if (sites.length === 0) {
        console.error('Error: could not fetch the site list from the worker.');
        console.error('Pass --site <domain> to print a snippet for a specific site.');
        process.exit(1);
      }
      for (const site of sites) {
        console.log(`<!-- ${site} -->`);
        console.log(trackingSnippet(apiUrl, site));
      }
    });

  return cmd;
}
