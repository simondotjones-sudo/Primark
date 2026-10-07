import {storeDirectory} from '@/lib/store-directory';
export const dynamic='force-dynamic';
export async function GET(){try{return Response.json({stores:await storeDirectory()},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Please try again.'},{status:503});}}
