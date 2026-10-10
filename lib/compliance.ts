export function complianceBand(completed:number,assessed:number){return !assessed?'grey':completed*100>=assessed*90?'green':completed*100<assessed*50?'red':'amber';}
