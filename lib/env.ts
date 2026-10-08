import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("https://nuvicart.com"),
});

const serverEnvSchema = publicEnvSchema.extend({ SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(), RAZORPAY_KEY_ID: z.string().min(1).optional(), RAZORPAY_KEY_SECRET: z.string().min(1).optional(), RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(), SHIPROCKET_EMAIL: z.string().email().optional(), SHIPROCKET_PASSWORD: z.string().min(1).optional(), SHIPROCKET_BASE_URL: z.string().url().default("https://apiv2.shiprocket.in/v1/external"), SHIPROCKET_WEBHOOK_SECRET: z.string().min(1).optional(), SHIPROCKET_PICKUP_LOCATION: z.string().min(1).optional(), SHIPROCKET_PACKAGE_WEIGHT_KG: z.coerce.number().positive().default(0.5), SHIPROCKET_PACKAGE_LENGTH_CM: z.coerce.number().positive().default(10), SHIPROCKET_PACKAGE_BREADTH_CM: z.coerce.number().positive().default(10), SHIPROCKET_PACKAGE_HEIGHT_CM: z.coerce.number().positive().default(10), RESEND_API_KEY: z.string().min(1).optional(), RESEND_FROM_EMAIL: z.string().email().optional(), RESEND_FROM_NAME: z.string().min(1).max(120).optional() });

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});

export const serverEnv = serverEnvSchema.parse({
  ...publicEnv,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET, SHIPROCKET_EMAIL: process.env.SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD: process.env.SHIPROCKET_PASSWORD, SHIPROCKET_BASE_URL: process.env.SHIPROCKET_BASE_URL, SHIPROCKET_WEBHOOK_SECRET: process.env.SHIPROCKET_WEBHOOK_SECRET, SHIPROCKET_PICKUP_LOCATION: process.env.SHIPROCKET_PICKUP_LOCATION, SHIPROCKET_PACKAGE_WEIGHT_KG: process.env.SHIPROCKET_PACKAGE_WEIGHT_KG, SHIPROCKET_PACKAGE_LENGTH_CM: process.env.SHIPROCKET_PACKAGE_LENGTH_CM, SHIPROCKET_PACKAGE_BREADTH_CM: process.env.SHIPROCKET_PACKAGE_BREADTH_CM, SHIPROCKET_PACKAGE_HEIGHT_CM: process.env.SHIPROCKET_PACKAGE_HEIGHT_CM, RESEND_API_KEY: process.env.RESEND_API_KEY, RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL, RESEND_FROM_NAME: process.env.RESEND_FROM_NAME,
});

export function hasSupabasePublicConfig() {
  return Boolean(publicEnv.NEXT_PUBLIC_SUPABASE_URL && publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
