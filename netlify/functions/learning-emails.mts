import {runEmailNotifications} from '../../lib/email-worker';
export default async()=>{const result=await runEmailNotifications();console.log('Learning email processing',result);};
export const config={schedule:'11,26,41,56 * * * *'};
