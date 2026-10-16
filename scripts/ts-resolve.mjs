// Lets plain `node scripts/test-*.mjs` load the app's TypeScript lib files, whose imports
// leave out the ".ts" extension (as the bundler allows). Import this first, then import lib
// files with `await import(...)`.
import {register} from 'node:module';
const hook = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); }
  catch (e) {
    if ((spec.startsWith('.') || spec.startsWith('/')) && !/\\.[cm]?[jt]sx?$/.test(spec)) {
      for (const ext of ['.ts', '.tsx', '/index.ts']) { try { return await next(spec + ext, ctx); } catch {} }
    }
    throw e;
  }
}`;
register('data:text/javascript,' + encodeURIComponent(hook));
