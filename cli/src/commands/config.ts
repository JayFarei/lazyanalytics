import { Command } from 'commander';
import { CONFIG_ENV_PATH, readEnvFile, writeEnvFile } from '../lib/env.js';

/** Keys whose values must never be printed in full. */
const SENSITIVE_KEY = /TOKEN|SECRET|SALT|PASSWORD/i;

function maskValue(value: string): string {
  if (value.length <= 4) return '****';
  return '****' + value.slice(-4);
}

export function configCommand(): Command {
  const cmd = new Command('config');
  cmd.description(`Inspect and edit the CLI config file (${CONFIG_ENV_PATH})`);

  cmd
    .command('path')
    .description('Print the config file path')
    .action(() => {
      console.log(CONFIG_ENV_PATH);
    });

  cmd
    .command('get <key>')
    .description('Print a config value (sensitive values are masked)')
    .action((key: string) => {
      const vars = readEnvFile(CONFIG_ENV_PATH);
      if (!(key in vars)) {
        console.error(`Error: ${key} is not set in ${CONFIG_ENV_PATH}`);
        process.exit(2);
      }
      const value = vars[key];
      console.log(SENSITIVE_KEY.test(key) ? maskValue(value) : value);
    });

  cmd
    .command('set <key> <value>')
    .description('Set a config value (file is written with mode 0600)')
    .action((key: string, value: string) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        console.error(`Error: invalid key "${key}" (use letters, digits, underscores)`);
        process.exit(1);
      }
      const vars = readEnvFile(CONFIG_ENV_PATH);
      vars[key] = value;
      writeEnvFile(CONFIG_ENV_PATH, vars);
      console.log(`Set ${key} in ${CONFIG_ENV_PATH}`);
    });

  return cmd;
}
