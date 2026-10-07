'use client';
export default function AdminSummary({items}:{items:{label:string;value:number;blue?:boolean}[]}){
 return <div className="metrics admin-summary" data-count={items.length}>{items.map(item=><div key={item.label} className={'metric'+(item.blue?' metric-blue':'')}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>;
}
