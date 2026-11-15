import {z} from 'zod';
export const billingProfileSchema=z.object({name:z.string().trim().min(1).max(500),address:z.string().trim().min(1,'Enter MEC’s business address.').max(2000),email:z.string().max(500),taxId:z.string().max(500),bank:z.string().max(500),accountName:z.string().max(500),account:z.string().max(100),terms:z.string().max(10000)});
export type BillingProfile=z.infer<typeof billingProfileSchema>;
export const defaultBillingProfile:BillingProfile={name:'Mansfield Eyre Consulting Limited',address:'',email:'',taxId:'',bank:'',accountName:'Mansfield Eyre Consulting Limited',account:'',terms:''};
