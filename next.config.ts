import type { NextConfig } from "next";

const supabaseOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return "";
  try { return new URL(raw).origin; } catch { return ""; }
})();

const isDev = process.env.NODE_ENV !== "production";
const scriptSrc = ["'self'", "'unsafe-inline'", isDev ? "'unsafe-eval'" : "", "https://checkout.razorpay.com"]
  .filter(Boolean)
  .join(" ");

const connectSrc = ["'self'", "https://api.razorpay.com", supabaseOrigin].filter(Boolean).join(" ");
const securityHeaders = [
  { key: "Content-Security-Policy", value: `default-src 'self'; script-src ${scriptSrc}; frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com; connect-src ${connectSrc}; img-src 'self' data: blob: https://images.unsplash.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'self'` },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self https://checkout.razorpay.com)" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }] },
  async headers() { return [{ source: "/(.*)", headers: securityHeaders }]; },
};

export default nextConfig;
