import {z} from 'zod';
export const catalogItemSchema=z.object({id:z.string().min(1).max(100),name:z.string().trim().min(1).max(500),type:z.enum(['Program','Service','Product']),description:z.string().max(5000).default(''),rate:z.number().nonnegative().nullable().default(null),currency:z.enum(['NGN','USD','GBP','EUR']).default('NGN'),active:z.boolean().default(true)});
export type CatalogItem=z.infer<typeof catalogItemSchema>;
export const catalogSchema=z.array(catalogItemSchema).max(1000);
