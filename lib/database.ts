import {env} from 'cloudflare:workers';
export function database(){if(!env.DB)throw new Error('Database unavailable');return env.DB;}
export function decode(r:any){return {...JSON.parse(r.data),id:r.id,kind:r.kind,parent:r.parent,sourceId:r.source_id,version:r.version,total:r.total,paid:r.paid,updated:r.updated};}
