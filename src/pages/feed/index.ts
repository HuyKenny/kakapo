import type { APIRoute } from 'astro';
export const prerender = false;
// WordPress exposed an RSS feed (/feed/); the site has no posts, so an empty valid channel keeps old subscribers/crawlers happy.
export const GET: APIRoute = () => new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Kakapo.cz</title><link>https://kakapo.cz/</link><description>Srovnávač dovolených</description><language>cs</language></channel></rss>`, { headers: { 'content-type': 'application/rss+xml; charset=UTF-8', 'cache-control': 'public, max-age=3600' } });
