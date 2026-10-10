import {syncCourseRefreshers} from '../../lib/course-refreshers';
// Runs on published deployments every 15 minutes, UTC; no public endpoint.
export default async()=>{
 console.log('Course refreshers checked',await syncCourseRefreshers());
};
export const config={schedule:'*/15 * * * *'};
