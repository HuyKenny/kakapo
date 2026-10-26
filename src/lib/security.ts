/** Security headers for SSR responses (middleware) and static files (public/_headers mirrors them). */
export function csp(analytics: boolean): string {
  const ga = analytics ? ' https://www.googletagmanager.com' : '';
  const gaConnect = analytics ? ' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com' : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'inline-speculation-rules'${ga}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${analytics ? ' https://*.google-analytics.com https://www.googletagmanager.com' : ''}`,
    "frame-src https://maps.google.com https://www.google.com",
    `connect-src 'self'${gaConnect}`,
    "font-src 'self'",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export function securityHeaders(analytics: boolean): Record<string, string> {
  return {
    'Content-Security-Policy': csp(analytics),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'X-Permitted-Cross-Domain-Policies': 'none',
  };
}
