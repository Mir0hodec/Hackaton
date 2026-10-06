import {AsyncLocalStorage} from 'node:async_hooks';
export type DemoContext={space:string;user:string};
export const demoContext=new AsyncLocalStorage<DemoContext>();
export const namespace=()=>demoContext.getStore()?.space?'demo:'+demoContext.getStore()!.space+':':'';
export const ownerKey=(id:string)=>namespace()+id;
