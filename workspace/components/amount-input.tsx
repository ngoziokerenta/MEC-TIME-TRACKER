'use client';
import {useLayoutEffect,useRef} from 'react';
import {formatNumericInput} from '../lib/invoice';

export default function AmountInput({value,onChange,required=false,label,disabled=false}:{value:string|number;onChange:(v:string)=>void;required?:boolean;label?:string;disabled?:boolean}){
 const input=useRef<HTMLInputElement>(null),caret=useRef<number|null>(null);
 const text=formatNumericInput(value);
 useLayoutEffect(()=>{if(caret.current===null||!input.current)return;let count=0,pos=0;for(;pos<text.length&&count<caret.current;pos++)if(text[pos]!==',')count++;input.current.setSelectionRange(pos,pos);caret.current=null;},[text]);
 return <input ref={input} aria-label={label} disabled={disabled} type="text" inputMode="decimal" autoComplete="off" required={required} value={text} placeholder="0" onKeyDown={e=>{const target=e.currentTarget,start=target.selectionStart??0,end=target.selectionEnd??0;if(e.key==='Backspace'&&start===end&&start>1&&target.value[start-1]===','){e.preventDefault();const raw=target.value.replaceAll(',',''),index=target.value.slice(0,start).replaceAll(',','').length;caret.current=index-1;onChange(raw.slice(0,index-1)+raw.slice(index));}}} onChange={e=>{const raw=e.target.value.replace(/[,\s₦$£€]/g,'');if(!/^\d*(\.\d{0,2})?$/.test(raw))return;caret.current=e.target.value.slice(0,e.target.selectionStart??0).replaceAll(',','').length;onChange(raw);}}/>;
}
