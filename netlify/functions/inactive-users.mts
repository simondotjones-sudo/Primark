import {getDatabase} from '@netlify/database';
export default async()=>{
 const {rows:[result]}=await getDatabase().pool.query('SELECT auto_archive_inactive_users() AS archived');
 console.log('Inactive learner archive check',{archived:result.archived});
};
export const config={schedule:'17 * * * *'};
