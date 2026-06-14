import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { collect } from './collect';
import { serveTracker } from './tracker';
import { serveDashboard } from './dashboard';
import { authMiddleware } from './lib/auth';
import { statsHandler } from './api/stats';
import { pagesHandler } from './api/pages';
import { referrersHandler } from './api/referrers';
import { geoHandler } from './api/geo';
import { browsersHandler } from './api/browsers';
import { timeseriesHandler } from './api/timeseries';
import { sitesHandler } from './api/sites';
import { activeHandler } from './api/active';
import { crawlersHandler } from './api/crawlers';
import { channelsHandler } from './api/channels';
import { bounceHandler } from './api/bounce';
import { durationHandler } from './api/duration';
import { historyHandler } from './api/history';
import { scheduled } from './scheduled';
import { VERSION } from './version';

export interface Env {
  ANALYTICS: AnalyticsEngineDataset;
  API_SECRET: string;
  HASH_SALT: string;
  ALLOWED_SITES: string;
  TRACK_AI_CRAWLERS?: string;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  ARCHIVE?: R2Bucket;
}

export const app = new Hono<{ Bindings: Env }>();

// CORS for browser-based API consumers (not needed for CLI, but doesn't hurt)
app.use('/api/*', cors());

// CORS + preflight for the beacon endpoint (cross-origin POSTs from tracked sites)
app.use('/collect', cors());

// Public endpoints
app.get('/tracker.js', serveTracker);
app.post('/collect', collect);

// Dashboard UI (page is public; data calls require the API token, entered in-page)
app.get('/dashboard', serveDashboard);

// Authenticated API endpoints
app.use('/api/*', authMiddleware);
app.get('/api/stats', statsHandler);
app.get('/api/pages', pagesHandler);
app.get('/api/referrers', referrersHandler);
app.get('/api/geo', geoHandler);
app.get('/api/browsers', browsersHandler);
app.get('/api/timeseries', timeseriesHandler);
app.get('/api/sites', sitesHandler);
app.get('/api/active', activeHandler);
app.get('/api/crawlers', crawlersHandler);
app.get('/api/channels', channelsHandler);
app.get('/api/bounce', bounceHandler);
app.get('/api/duration', durationHandler);
app.get('/api/history', historyHandler);

// Health check
app.get('/health', (c) => c.json({ status: 'ok', version: VERSION, timestamp: new Date().toISOString() }));

const worker = {
  fetch: app.fetch,
  scheduled,
  request: app.request.bind(app),
};

export default worker;
