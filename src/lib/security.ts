/** Security headers for SSR responses. No CSP yet: the WordPress site had none and Alpine needs unsafe-eval (tracked in docs/SEO-MIGRATION.md). */
export function securityHeaders(_analytics: boolean): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Permitted-Cross-Domain-Policies': 'none',
  };
}
