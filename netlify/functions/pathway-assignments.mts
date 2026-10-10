import {getDatabase} from '@netlify/database';
// Catch future start dates and retry credit/course failures even when learners are offline.
export default async()=>{
 const {rows:[result]}=await getDatabase().pool.query('SELECT sync_pathway_assignments() AS assigned');
 console.log('Automatic pathway assignments checked',{assigned:result.assigned});
};
export const config={schedule:'7,22,37,52 * * * *'};
