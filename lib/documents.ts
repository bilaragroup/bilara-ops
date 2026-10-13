import {env} from 'cloudflare:workers';
export function documentStorage(){if(!env.FILES)throw Error('Document storage unavailable');return env.FILES;}
export function decodeDocument(r:any){const {object_key,...meta}=r;return {...meta,...JSON.parse(r.data),data:undefined};}
export async function boundedBody(req:Request,limit:number){const reader=req.body?.getReader();if(!reader)throw Error('Empty upload');let size=0;const parts:Uint8Array[]=[];while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('Upload is too large');}parts.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;}

export function validDriveLink(value:any){try{const u=new URL(value);return u.protocol==='https:'&&['drive.google.com','docs.google.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port&&u.pathname!=='/';}catch{return false;}}
