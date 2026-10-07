import Player from './player';
import './player.css';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{preview?:string}>}){return <Player courseId={(await params).id} preview={(await searchParams).preview==='1'}/>;}
