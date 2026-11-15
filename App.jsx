import React from 'react';
import TimeTracker from './TimeTracker';

export default function App() {
  return <>
    <style>{'@media print{.mec-tool-nav{display:none!important}}'}</style>
    <nav className="mec-tool-nav" aria-label="MEC tools" style={{display:'flex',justifyContent:'center',gap:24,padding:'12px 16px',background:'#360B5C',fontFamily:'Arial,sans-serif',fontSize:14}}>
      <a href="/" aria-current="page" style={{color:'white',fontWeight:700,textDecoration:'none'}}>Clocker</a>
      <a href="https://mec-invoices.vercel.app" style={{color:'white',textDecoration:'none'}}>Invoices ↗</a>
    </nav>
    <TimeTracker />
  </>;
}
