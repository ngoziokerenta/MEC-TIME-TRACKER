import type {NextConfig} from 'next';
const config:NextConfig={
 poweredByHeader:false,
 async redirects(){return [{source:'/',destination:'https://mec-workspace.vercel.app/#finance-invoices',permanent:false}]}
};
export default config;
