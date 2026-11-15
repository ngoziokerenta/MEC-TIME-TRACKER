'use client';
import {useEffect,useState} from 'react';
import {catalogSchema,type CatalogItem} from '../lib/catalog';
import AmountInput from './amount-input';

export default function CatalogEditor({catalog,busy,onSave}:{catalog:CatalogItem[];busy:boolean;onSave:(items:CatalogItem[])=>Promise<boolean>}){
 const [items,setItems]=useState<CatalogItem[]>(catalog),[error,setError]=useState('');
 useEffect(()=>setItems(catalog),[catalog]);
 const update=(id:string,patch:Partial<CatalogItem>)=>setItems(list=>list.map(x=>x.id===id?{...x,...patch}:x));
 return <form className="panel settings" onSubmit={async e=>{e.preventDefault();setError('');const parsed=catalogSchema.safeParse(items);if(!parsed.success){setError(parsed.error.issues[0].message);return;}await onSave(parsed.data);}}>
  <h2>Programs, services &amp; products</h2><p>Save your offerings here, then select them for a client or add them to an invoice.</p>
  {items.map(item=><fieldset className="catalog-entry" key={item.id}><div className="formgrid"><label>Name<input required value={item.name} onChange={e=>update(item.id,{name:e.target.value})}/></label><label>Type<select value={item.type} onChange={e=>update(item.id,{type:e.target.value as CatalogItem['type']})}>{['Program','Service','Product'].map(x=><option key={x}>{x}</option>)}</select></label></div><label>Description<textarea value={item.description} onChange={e=>update(item.id,{description:e.target.value})}/></label><div className="formgrid"><label>Price (optional)<AmountInput value={item.rate??''} onChange={v=>update(item.id,{rate:v===''?null:Number(v)})}/></label><label>Currency<select value={item.currency} onChange={e=>update(item.id,{currency:e.target.value as CatalogItem['currency']})}>{['NGN','USD','GBP','EUR'].map(x=><option key={x}>{x}</option>)}</select></label></div><label className="discount-toggle"><input type="checkbox" checked={item.active} onChange={e=>update(item.id,{active:e.target.checked})}/>Available for new invoices</label></fieldset>)}
  {error&&<p role="alert" className="error">{error}</p>}<div className="catalog-actions"><button type="button" disabled={busy} onClick={()=>setItems([...items,{id:crypto.randomUUID(),name:'',type:'Service',description:'',rate:null,currency:'NGN',active:true}])}>Add offering</button><button className="primary" disabled={busy}>Save offerings</button></div>
 </form>;
}
