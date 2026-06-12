import { Command } from 'commander';
import { loadEnv } from '../lib/env.js';

const FREE_PLAN_DAILY_LIMIT = 100_000;
const FREE_PLAN_MONTHLY_LIMIT = FREE_PLAN_DAILY_LIMIT * 30; // ~3M

interface GraphQLResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        workersInvocationsAdaptive?: Array<{
          sum: { requests: number; errors: number; subrequests: number };
          quantiles: { cpuTimeP50: number; cpuTimeP99: number };
          dimensions: { datetime: string };
        }>;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

async function queryWorkerMetrics(
  accountId: string,
  scriptName: string,
  startDate: string,
  endDate: string,
): Promise<GraphQLResponse> {
  const query = `query {
    viewer {
      accounts(filter: {accountTag: "${accountId}"}) {
        workersInvocationsAdaptive(
          limit: 1000,
          filter: {
            scriptName: "${scriptName}",
            datetime_geq: "${startDate}",
            datetime_leq: "${endDate}"
          }
        ) {
          sum { requests errors subrequests }
          quantiles { cpuTimeP50 cpuTimeP99 }
          dimensions { datetime }
        }
      }
    }
  }`;

  // In proxy mode (HTTPS_PROXY set), the credential proxy injects the
  // Authorization header. In direct mode, we add it ourselves.
  const proxyMode = !!process.env.HTTPS_PROXY;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!proxyMode) {
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!apiToken) {
      throw new Error('CLOUDFLARE_API_TOKEN env var is required.');
    }
    headers.Authorization = `Bearer ${apiToken}`;
  }

  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });

  return res.json() as Promise<GraphQLResponse>;
}

export function usageCommand(): Command {
  const cmd = new Command('usage');
  cmd
    .description(
      'Show Worker request usage, free plan capacity, and estimated cost. ' +
        'Requires CF_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.',
    )
    .option('-p, --period <period>', 'Lookback period: today, 7d, 30d', 'today')
    .option(
      '-w, --worker <name>',
      'Worker script name (defaults to ANALYTICS_WORKER_NAME env or lazyanalytics)',
    )
    .option('--json', 'Output as JSON (default)', true)
    .option('--table', 'Output as human-readable table')
    .action(async (opts) => {
      loadEnv();
      const accountId = process.env.CF_ACCOUNT_ID;
      const proxyMode = !!process.env.HTTPS_PROXY;

      if (!accountId) {
        console.error('Error: CF_ACCOUNT_ID env var required (Cloudflare account identifier)');
        console.error('Find it at: dash.cloudflare.com > Workers & Pages > right sidebar');
        process.exit(3);
      }

      if (!proxyMode && !process.env.CLOUDFLARE_API_TOKEN) {
        console.error('Error: CLOUDFLARE_API_TOKEN env var is required.');
        console.error('Create one at dash.cloudflare.com with Account Analytics:Read permission.');
        process.exit(3);
      }

      const now = new Date();
      let startDate: Date;
      let periodLabel: string;

      switch (opts.period) {
        case '7d':
          startDate = new Date(now.getTime() - 7 * 86400000);
          periodLabel = '7d';
          break;
        case '30d':
          startDate = new Date(now.getTime() - 30 * 86400000);
          periodLabel = '30d';
          break;
        default:
          startDate = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z');
          periodLabel = 'today';
      }

      const workerName = opts.worker || process.env.ANALYTICS_WORKER_NAME || 'lazyanalytics';

      try {
        const result = await queryWorkerMetrics(
          accountId,
          workerName,
          startDate.toISOString(),
          now.toISOString(),
        );

        if (result.errors?.length) {
          console.error(`GraphQL error: ${result.errors[0].message}`);
          process.exit(1);
        }

        const rows = result.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];

        const totalRequests = rows.reduce((sum, r) => sum + r.sum.requests, 0);
        const totalErrors = rows.reduce((sum, r) => sum + r.sum.errors, 0);
        const avgCpuP50 = rows.length > 0
          ? rows.reduce((sum, r) => sum + r.quantiles.cpuTimeP50, 0) / rows.length
          : 0;

        const days = Math.max(1, Math.ceil((now.getTime() - startDate.getTime()) / 86400000));
        const avgRequestsPerDay = Math.round(totalRequests / days);

        // Cost projections
        const projectedMonthlyRequests = avgRequestsPerDay * 30;
        const freePlanPct = Math.round((avgRequestsPerDay / FREE_PLAN_DAILY_LIMIT) * 100 * 10) / 10;
        const needsPaidPlan = avgRequestsPerDay > FREE_PLAN_DAILY_LIMIT;

        // AE cost estimate (once billing starts)
        // Roughly half of requests are /collect writes, rest are tracker.js/api/heartbeat
        const estimatedWritesPerDay = Math.round(avgRequestsPerDay * 0.4);
        const aeWriteCostMonthly = (estimatedWritesPerDay * 30 / 1_000_000) * 0.25;
        const aeQueryCostMonthly = 0.001; // negligible at this scale

        const output = {
          period: periodLabel,
          requests: {
            total: totalRequests,
            errors: totalErrors,
            avg_per_day: avgRequestsPerDay,
            projected_monthly: projectedMonthlyRequests,
          },
          cpu: {
            p50_ms: Math.round(avgCpuP50 * 100) / 100,
          },
          free_plan: {
            daily_limit: FREE_PLAN_DAILY_LIMIT,
            daily_usage_pct: freePlanPct,
            monthly_limit: FREE_PLAN_MONTHLY_LIMIT,
            needs_paid_plan: needsPaidPlan,
            headroom: `${Math.round(FREE_PLAN_DAILY_LIMIT / Math.max(avgRequestsPerDay, 1))}x before hitting limit`,
          },
          estimated_monthly_cost: {
            workers: needsPaidPlan ? '$5.00 (paid plan)' : '$0.00 (free plan)',
            analytics_engine_writes: `$${aeWriteCostMonthly.toFixed(4)} (once billing starts)`,
            analytics_engine_queries: `$${aeQueryCostMonthly.toFixed(4)}`,
            total: needsPaidPlan
              ? `~$${(5 + aeWriteCostMonthly + aeQueryCostMonthly).toFixed(2)}`
              : `~$${(aeWriteCostMonthly + aeQueryCostMonthly).toFixed(4)} (currently $0, AE not billing yet)`,
          },
        };

        if (opts.table) {
          console.log(`\n  Usage Report (${periodLabel})`);
          console.log(`  ${'─'.repeat(50)}`);
          console.log(`  Requests:          ${totalRequests.toLocaleString()} total (${totalErrors} errors)`);
          console.log(`  Avg/day:           ${avgRequestsPerDay.toLocaleString()} requests`);
          console.log(`  CPU time (p50):    ${output.cpu.p50_ms}ms`);
          console.log(`  ${'─'.repeat(50)}`);
          console.log(`  Free plan usage:   ${freePlanPct}% of daily limit (${FREE_PLAN_DAILY_LIMIT.toLocaleString()}/day)`);
          console.log(`  Headroom:          ${output.free_plan.headroom}`);
          console.log(`  Needs paid plan:   ${needsPaidPlan ? 'YES' : 'No'}`);
          console.log(`  ${'─'.repeat(50)}`);
          console.log(`  Est. monthly cost: ${output.estimated_monthly_cost.total}`);
          console.log('');
        } else {
          console.log(JSON.stringify(output, null, 2));
        }
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  return cmd;
}
