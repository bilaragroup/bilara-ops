import {protect} from '@/lib/access';
import {Actor} from '@/lib/permissions';
import {database} from '@/lib/database';
import {planGrn,grnStatements} from '@/lib/grn-plan';

// Goods received at site.
//  action 'receive' (Site Engineer, PM or Purchase): one GRN for one PO, with received /
//    accepted / rejected quantity per line. Partial and repeated deliveries are allowed;
//    accepting more than was ordered is refused. Each GRN creates a payment schedule for the
//    ACCEPTED value (due = GRN date + credit days) and takes the same amount out of the PO's
//    forecast schedule, using any advance already paid first.
//  action 'shortClose' (Purchase Manager / Team): the vendor will not send the rest. The line's
//    quantity and value become what was accepted; the unpaid forecast for the rest is cancelled.
// Everything for one call is written all-or-nothing with version checks (lib/grn-plan.ts).
// Receiving goods is normally done from the site Receive goods page, which also numbers the
// GRN and posts site stock; see lib/site/grn.ts.
const fail=(error:string,status=400)=>Response.json({error},{status});

async function handlePOST(req:Request,a:Actor){try{
 const b=JSON.parse(await req.text()),db=database();
 const plan=await planGrn(a,b,db);if(!plan.ok)return fail(plan.error,plan.status);
 const {statements}=grnStatements(db,a,b,plan);
 const result=await db.batch(statements);if(!result[0].meta.changes)return fail('A PO line or payment changed. Refresh and try again.',409);
 return Response.json({ok:true,schedules:plan.inserts.length});
}catch{return fail('Unable to save. Refresh and try again.');}}

export async function POST(req:Request){return protect(req,'grn',handlePOST);}
