// Common validated model every feed adapter converts to. Adapters never write to D1 directly.
import { z } from 'zod';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const url = z.string().regex(/^https?:\/\//i, 'url must be http(s)').max(8000);

export const NormHotel = z.object({
  name: z.string().trim().min(1).max(255),
  country: z.string().trim().max(100).default(''),
  destination: z.string().trim().max(150).default(''),
  city: z.string().trim().max(150).default(''),
  giata_id: z.number().int().positive().nullable().default(null),
  stars: z.number().int().min(0).max(5).default(0),
  rating: z.number().min(0).max(10).nullable().default(null),
  rating_count: z.number().int().min(0).default(0),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
  description: z.string().default(''),
  images: z.array(z.string()).default([]),
  amenities: z.array(z.string()).default([]),
});
export type NormHotel = z.infer<typeof NormHotel>;

export const NormOffer = z.object({
  external_id: z.string().trim().min(1).max(191),
  title: z.string().max(255).default(''),
  price_pp: z.number().int().positive().max(10_000_000),
  price_total: z.number().int().positive().nullable().default(null),
  price_original: z.number().int().positive().nullable().default(null),
  currency: z.string().length(3).default('CZK'),
  price_basis: z.enum(['person', 'room', 'booking']).default('person'),
  departure_date: ymd,
  return_date: ymd.nullable().default(null),
  nights: z.number().int().min(1).max(120).default(7),
  meal_type: z.string().default('bez-stravy'),
  transport: z.string().default('letecky'),
  airport: z.string().max(100).default(''),
  arrival_airport: z.string().max(100).default(''),
  room_type: z.string().max(150).default(''),
  adults: z.number().int().min(1).default(2),
  children: z.number().int().min(0).default(0),
  availability: z.string().default('available'),
  affiliate_url: url,
  image_url: z.string().nullable().default(null),
});
export type NormOffer = z.infer<typeof NormOffer>;

export const Term = z.object({ from: ymd, to: ymd.nullable(), nights: z.number().int().min(0), price: z.number().int().positive(), url: z.string() });
export type Term = z.infer<typeof Term>;

export const NormProduct = z.object({
  external_id: z.string().default(''),
  title: z.string().trim().min(1).max(255),
  description: z.string().default(''),
  price: z.number().int().positive().max(10_000_000),
  currency: z.string().length(3).default('CZK'),
  country: z.string().trim().max(100).default(''),
  destination: z.string().max(150).default(''),
  place: z.string().max(150).default(''),
  images: z.array(z.string()).default([]),
  nights: z.number().int().positive().nullable().default(null),
  date_from: ymd.nullable().default(null),
  date_to: ymd.nullable().default(null),
  meal: z.string().default(''),
  transport: z.string().default(''),
  affiliate_url: url,
  type: z.string().default('zajezdy'),
  type_raw: z.string().default(''),
  terms: z.array(Term).default([]),
});
export type NormProduct = z.infer<typeof NormProduct>;

/** One line of a normalised NDJSON block stored in R2. */
export type BlockRecord =
  | { k: 'h'; hotel: NormHotel; offers: NormOffer[] }
  | { k: 'p'; product: NormProduct };

export interface Rejection { external_id: string | null; reason: string }

export interface FeedRow {
  id: number;
  name: string;
  partner_slug: string;
  adapter: string;
  content_type: 'hotels' | 'products';
  is_full_catalogue: number;
  source_ref: string;
  source_kind: 'http' | 'cj' | 'r2';
  affiliate_params: string;
  interval_hours: number;
  enabled: number;
  paused: number;
  force_run: number;
  mapping_json: string;
  format_preset: string;
  etag: string | null;
  last_modified: string | null;
  last_success_run: number | null;
  last_success_at: string | null;
  last_success_count: number | null;
  next_run_at: string | null;
  lock_until: string | null;
  current_run: number | null;
}
