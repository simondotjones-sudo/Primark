export type StoreOption = {id:string;name:string;country:string;storeCode?:string|null;active?:boolean};

// Official names are not unique: show the code wherever a user chooses a store.
export function storeLabel(store:Pick<StoreOption,'name'|'storeCode'>) {
  return store.storeCode ? `${store.name} (${store.storeCode})` : store.name;
}
