import {z} from 'zod';
import {catalogSchema} from './catalog';
import {invoiceSchema,defaultNumbering,numberingSchema} from './invoice';

export const emptyState={company:{name:'Mansfield Eyre Consulting Limited',email:'',address:'',taxId:'',bank:'',account:'',accountName:'',terms:''},numbering:defaultNumbering,catalog:[],clients:[],invoices:[],next:1};
export const stateSchema=z.object({
 company:z.object({name:z.string().max(500),email:z.string().max(500),address:z.string().max(2000),taxId:z.string().max(500).optional(),bank:z.string().max(500),account:z.string().max(500),accountName:z.string().max(500),terms:z.string().max(10000)}),
 numbering:numberingSchema,
 catalog:catalogSchema,
 clients:z.array(z.object({id:z.string().min(1).max(100),name:z.string().trim().min(1).max(500),email:z.string().max(500),address:z.string().max(2000),vendorNumber:z.string().max(500).optional(),offeringIds:z.array(z.string().max(100)).optional()})).max(1000),
 invoices:z.array(invoiceSchema).max(10000),next:z.number().int().positive()
});
