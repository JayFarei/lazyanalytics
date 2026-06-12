import { Command } from 'commander';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { packagedSkill } from '../lib/paths.js';

export function skillCommand(): Command {
  const cmd = new Command('skill');
  cmd.description('Manage the Claude Code skill for lazyanalytics');

  cmd
    .command('install')
    .description('Install the lazyanalytics skill for Claude Code')
    .option('--project', 'Install into ./.claude/skills/lazyanalytics instead of the home directory')
    .action((opts) => {
      const source = packagedSkill();
      if (!existsSync(source)) {
        console.error(`Error: packaged skill not found at ${source}`);
        process.exit(1);
      }
      const targetDir = opts.project
        ? resolve(process.cwd(), '.claude', 'skills', 'lazyanalytics')
        : join(homedir(), '.claude', 'skills', 'lazyanalytics');
      const target = join(targetDir, 'SKILL.md');
      mkdirSync(targetDir, { recursive: true });
      copyFileSync(source, target);
      console.log(`Skill installed at ${target}`);
    });

  return cmd;
}
