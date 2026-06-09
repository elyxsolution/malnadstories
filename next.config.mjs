/** @type {import('next').NextConfig} */
// `'unsafe-eval'` is only needed by the Next.js dev server; a production build never
// evals. Gate it to development so prod ships a tighter script-src. (`'unsafe-inline'`
// for scripts is still required by the App Router's inline bootstrap until a nonce-
// based CSP is wired through middleware — tracked in docs/DEPLOYMENT.md.)
const isDev = process.env.NODE_ENV !== 'production';
const scriptSrc = [
  "script-src 'self'",
  isDev ? "'unsafe-eval'" : '',
  "'unsafe-inline'",
  'https://checkout.razorpay.com',
]
  .filter(Boolean)
  .join(' ');

const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // checkout.razorpay.com serves the Checkout script. 'unsafe-eval' is
              // dev-only (see scriptSrc above); 'unsafe-inline' pending nonce rollout.
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.supabase.co https://*.r2.cloudflarestorage.com https://*.razorpay.com",
              "font-src 'self'",
              // Razorpay Checkout calls its API + telemetry endpoints from the browser.
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.r2.cloudflarestorage.com https://*.razorpay.com https://lumberjack.razorpay.com",
              // Checkout opens its payment UI in an iframe.
              "frame-src 'self' https://api.razorpay.com https://*.razorpay.com",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self' https://api.razorpay.com",
            ].join('; '),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
