#!/usr/bin/env node
import { Command } from 'commander';
import { makeCommand } from './commands/base.js';
import { usageCommand } from './commands/usage.js';
import { setupCommand } from './commands/setup.js';
import { sitesCommand } from './commands/sites.js';
import { snippetCommand } from './commands/snippet.js';
import { skillCommand } from './commands/skill.js';
import { configCommand } from './commands/config.js';
import { packageVersion } from './lib/paths.js';

const program = new Command();

program
  .name('lazyanalytics')
  .description(
    'Agent-first analytics CLI: deploy the worker (setup), manage tracked sites (sites), ' +
      'print tracking snippets (snippet), install the Claude skill (skill), manage config ' +
      '(config), and query web property statistics. Returns JSON by default for ' +
      'programmatic consumption.',
  )
  .version(packageVersion());

program.addCommand(makeCommand('stats', 'Aggregate statistics (pageviews, approx visitors, avg screen width)'));
program.addCommand(makeCommand('pages', 'Top pages by view count'));
program.addCommand(makeCommand('referrers', 'Top referrer domains'));
program.addCommand(makeCommand('geo', 'Geographic breakdown by country'));
program.addCommand(
  makeCommand('browsers', 'Browser, OS, or device breakdown').option(
    '--type <type>',
    'Breakdown type: browser, os, device',
    'browser',
  ),
);
program.addCommand(
  makeCommand('timeseries', 'Pageview timeseries').option(
    '--unit <unit>',
    'Time bucket: hour, day',
    'day',
  ),
);

program.addCommand(usageCommand());
program.addCommand(setupCommand());
program.addCommand(sitesCommand());
program.addCommand(snippetCommand());
program.addCommand(skillCommand());
program.addCommand(configCommand());

program.parse();
