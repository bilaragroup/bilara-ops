// Runs the site emails that the QC app sent from its 5-minute Apps Script trigger
// (DPR 10 pm reminder, compliance summary, purchase GRN digest, material digest,
// low-stock digest, next-day QC office duty). Call it every 5 minutes from any
// scheduler with the header  x-site-cron-secret: <SITE_CRON_SECRET>.
// Each slot runs once per day; repeated calls send nothing twice.
import {env} from 'cloudflare:workers';
import {runConfiguredDailyEmailDispatcher} from '@/lib/site/ops';

async function handle(req: Request) {
  const secret = String((env as any)?.SITE_CRON_SECRET || '');
  if (!secret) return Response.json({error: 'SITE_CRON_SECRET is not set for the app.'}, {status: 503});
  const given = req.headers.get('x-site-cron-secret') || new URL(req.url).searchParams.get('secret') || '';
  if (given.length !== secret.length || given !== secret) return Response.json({error: 'Not allowed.'}, {status: 403});
  try {
    // Local test runs may set the time (same header as /api/site); the hosted site never runs on localhost.
    const testNow = new URL(req.url).hostname === 'localhost' ? req.headers.get('x-bilara-test-now') : null;
    return Response.json(await runConfiguredDailyEmailDispatcher(testNow ? {clock: () => new Date(testNow)} : {}));
  } catch (err) {
    return Response.json({error: err instanceof Error ? err.message : String(err)}, {status: 500});
  }
}

export const GET = handle;
export const POST = handle;
