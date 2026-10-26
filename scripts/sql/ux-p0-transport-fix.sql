-- UX/CRO P0 (27. 10. 2026): transport must not be invented.
-- Slevomat deals and any offer without a feed transport value, airport or flight-only operator were stored as 'letecky'.
UPDATE offers SET transport = 'vlastni' WHERE transport IN ('vlastní', 'vlastnim', 'auto');
UPDATE offers SET transport = 'neuvedeno' WHERE transport = 'letecky' AND airport = '' AND partner_slug NOT IN ('fischer', 'exim-tours', 'blue-style', 'tui');
