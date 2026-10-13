import {createRuntime} from './qa-runtime.mjs';
const runtime=await createRuntime();
const originalFetch=globalThis.fetch;
// The existing full workflow suite runs against real local Worker handlers and
// ephemeral D1/R2. No network request can escape this harness.
globalThis.fetch=async(url,options)=>{
 if(new URL(url).hostname!=='localhost')throw Error('External requests forbidden in QA');
 const request=new Request(url,options);
 return runtime.mf.dispatchFetch(url,{...options,headers:Object.fromEntries(request.headers),body:request.method==='GET'?undefined:await request.arrayBuffer()});
};
try{await import('./test-load-e2e.mjs');}finally{globalThis.fetch=originalFetch;await runtime.dispose();}
