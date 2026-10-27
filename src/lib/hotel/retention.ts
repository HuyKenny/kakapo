// One place for the hotel retention rule, shared by the web app (indexing grace, sitemap) and the import Worker (retire job).
/** Days without a live offer after which a hotel stops being indexable AND is retired (301 to its category). */
export const HOTEL_RETIRE_DAYS = 60;
