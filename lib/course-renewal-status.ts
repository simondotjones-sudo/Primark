export function renewalDays(expiresAt:string|null|undefined,now=Date.now()){
 if(!expiresAt)return null;
 const remaining=Date.parse(expiresAt)-now;
 if(!Number.isFinite(remaining)||remaining>30*86400000)return null;
 return Math.max(0,Math.ceil(remaining/86400000));
}
