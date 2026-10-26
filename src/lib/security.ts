/** Security headers for SSR responses. No CSP yet: the WordPress site had none and Alpine needs unsafe-eval (tracked in docs/SEO-MIGRATION.md). */
export function securityHeaders(_analytics: boolean): Record<string, string> {
  return {
    // No script-src restriction on purpose (Alpine.js evaluates expressions); the rest hardens framing, plugins, base and forms.
    'Content-Security-Policy': "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://*.cloudflareaccess.com; upgrade-insecure-requests",
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Permitted-Cross-Domain-Policies': 'none',
  };
}
