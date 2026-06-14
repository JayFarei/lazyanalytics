#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const DATASET = 'agent_analytics';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function escapeSql(value) {
  return value.replace(/'/g, "''");
}

function usage() {
  console.log(`Usage: node scripts/lazyanalytics-ae-probes.mjs --site <site>

Runs the two mandatory Analytics Engine probes without printing secret values.

Required credentials:
  CLOUDFLARE_API_TOKEN
  CF_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID

The script also loads ./.env and ~/.config/lazyanalytics/.env for non-secret
settings such as CF_ACCOUNT_ID.`);
}

async function sql(accountId, token, statement) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: statement,
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { ok: response.ok, status: response.status, body };
}

function firstNumber(result) {
  return Number(result.body?.data?.[0]?.c ?? 0);
}

loadEnvFile(resolve('.env'));
loadEnvFile(join(homedir(), '.config', 'lazyanalytics', '.env'));

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  usage();
  process.exit(0);
}

const site = arg('--site');
const accountId = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '';
const token = process.env.CLOUDFLARE_API_TOKEN || '';

if (!site || !accountId || !token) {
  usage();
  const missing = [
    !site && '--site',
    !accountId && 'CF_ACCOUNT_ID/CLOUDFLARE_ACCOUNT_ID',
    !token && 'CLOUDFLARE_API_TOKEN',
  ].filter(Boolean);
  console.error(`\nMissing: ${missing.join(', ')}`);
  process.exit(3);
}

const now = new Date();
const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  .toISOString()
  .replace('T', ' ')
  .replace(/\.\d{3}Z$/, '');
const end = now.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
const quotedSite = escapeSql(site);
const baseWhere = `blob1 = '${quotedSite}' AND timestamp >= toDateTime('${start}') AND timestamp <= toDateTime('${end}')`;

console.log('PROBE 1: derived table support');
const derived = await sql(accountId, token, 'SELECT x FROM (SELECT 1 AS x)');
console.log(JSON.stringify({
  ok: derived.ok,
  status: derived.status,
  expected: '4xx means handler-side aggregation is required',
}, null, 2));

console.log('\nPROBE 2: unset blob representation for blob10');
const [allRows, emptyRows, nullRows, combinedRows] = await Promise.all([
  sql(accountId, token, `SELECT SUM(_sample_interval) AS c FROM ${DATASET} WHERE ${baseWhere}`),
  sql(accountId, token, `SELECT SUM(_sample_interval) AS c FROM ${DATASET} WHERE ${baseWhere} AND blob10 = ''`),
  sql(accountId, token, `SELECT SUM(_sample_interval) AS c FROM ${DATASET} WHERE ${baseWhere} AND blob10 IS NULL`),
  sql(accountId, token, `SELECT SUM(_sample_interval) AS c FROM ${DATASET} WHERE ${baseWhere} AND (blob10 = '' OR blob10 IS NULL)`),
]);

for (const [name, result] of [
  ['all', allRows],
  ['empty_string', emptyRows],
  ['null', nullRows],
  ['empty_or_null', combinedRows],
]) {
  if (!result.ok) {
    console.log(JSON.stringify({ name, ok: false, status: result.status, body: result.body }, null, 2));
  }
}

const counts = {
  all: firstNumber(allRows),
  empty_string: firstNumber(emptyRows),
  null: firstNumber(nullRows),
  empty_or_null: firstNumber(combinedRows),
};
let recommendation = 'No rows matched; choose predicate only after probing a site with pre-0.2.0 rows.';
if (counts.all > 0 && counts.empty_string === counts.all) {
  recommendation = "Use blob10 = ''.";
} else if (counts.all > 0 && counts.null === counts.all) {
  recommendation = 'Use blob10 IS NULL.';
} else if (counts.all > 0 && counts.empty_or_null === counts.all) {
  recommendation = "Use (blob10 = '' OR blob10 IS NULL).";
}

console.log(JSON.stringify({ site, counts, recommendation }, null, 2));
