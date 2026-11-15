export default function MecBrand({subtitle='CONSULTING'}:{subtitle?:string}){
 return <span className="mec-site-logo" aria-label="Mansfield Eyre Consulting"><span className="mec-site-mark">ME</span><span className="mec-site-wordmark"><strong>Mansfield Eyre</strong><small>{subtitle}</small></span></span>;
}
