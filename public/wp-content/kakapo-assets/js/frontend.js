/**
 * Kakapo Travel Engine — frontend (vanilla JS + Alpine.js komponenty).
 *
 * Komponenty: kakapoFilters, kakapoOffers, kakapoGallery, kakapoSearchbar, kakapoOffcanvas.
 * renderCard() musí generovat stejný markup jako templates/parts/card-hotel.php.
 */
(function () {
	'use strict';

	// ------------------------------------------------------------ helpers

	var priceFmt = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });

	function fmtPrice(n) {
		// nezalomitelná mezera před "Kč" (U+00A0), ať se nezalomí na další řádek
		return priceFmt.format(Math.round(Number(n) || 0)) + ' Kč';
	}

	function fmtDate(ymd) {
		if (!ymd) {
			return '';
		}
		var d = new Date(String(ymd) + 'T00:00:00');
		return isNaN(d.getTime()) ? '' : d.toLocaleDateString('cs-CZ');
	}

	function nightsLabel(n) {
		n = parseInt(n, 10) || 0;
		if (n === 1) {
			return '1 noc';
		}
		if (n >= 2 && n <= 4) {
			return n + ' noci';
		}
		return n + ' nocí';
	}

	function fmtRating(r) {
		return (Math.round(Number(r) * 10) / 10).toFixed(1).replace('.', ',');
	}

	function esc(s) {
		var div = document.createElement('div');
		div.textContent = s === null || s === undefined ? '' : String(s);
		return div.innerHTML;
	}

	function escAttr(s) {
		return esc(s).replace(/"/g, '&quot;');
	}

	var STAR_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.26 6.86.83-5.07 4.7 1.35 6.77L12 17.2l-6.04 3.36 1.35-6.77-5.07-4.7 6.86-.83z"/></svg>';

	var PLACEHOLDER_SVG = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1"/></svg>';

	/**
	 * Karta hotelu — 1:1 markup s templates/parts/card-hotel.php.
	 * Vstup: položka z REST /search (image, url, best_offer.meal_label, partners…).
	 */
	function renderCard(h) {
		var best = h.best_offer || null;
		var price = null;
		var priceOriginal = null;
		var discount = null;

		if (best) {
			price = best.price_pp;
			if (best.price_original && best.price_original > best.price_pp) {
				priceOriginal = best.price_original;
				discount = best.discount !== null && best.discount !== undefined
					? best.discount
					: Math.round(100 * (1 - best.price_pp / best.price_original));
			}
		} else if (h.min_price !== null && h.min_price !== undefined) {
			price = h.min_price;
		}

		var isLm = best ? !!best.is_last_minute : false;
		var stars = Math.max(0, Math.min(5, parseInt(h.stars, 10) || 0));
		var partners = parseInt(h.partners, 10) || 0;

		var html = '<article class="card-k group">';

		html += '<div class="card-k-img">';
		if (h.image) {
			var cardSrcset = h.image_srcset ? ' srcset="' + escAttr(h.image_srcset) + '" sizes="(min-width:1280px) 22vw, (min-width:1024px) 30vw, (min-width:640px) 45vw, 92vw"' : '';
			html += '<img src="' + escAttr(h.image) + '"' + cardSrcset + ' alt="' + escAttr(h.name) + '" width="640" height="480" loading="lazy" decoding="async" onerror="this.style.display=\'none\'">';
		} else {
			html += '<div class="flex h-full w-full items-center justify-center text-slate-300" aria-hidden="true">' + PLACEHOLDER_SVG + '</div>';
		}
		html += '<div class="absolute left-3 top-3 flex flex-wrap gap-1.5">';
		if (isLm) {
			html += '<span class="badge badge-lm">Last minute</span>';
		}
		if (discount !== null && discount > 0) {
			html += '<span class="badge badge-sale">−' + esc(discount) + ' %</span>';
		}
		var drop = parseInt(h.price_drop, 10) || 0;
		if (drop >= 5) {
			html += '<span class="badge badge-drop">Cena klesla o ' + esc(drop) + ' %</span>';
		}
		html += '</div></div>';

		html += '<div class="flex flex-1 flex-col pt-3">';
		html += '<div class="flex items-start justify-between gap-3">';
		html += '<h3 class="text-[15px] font-bold leading-snug text-ink"><a href="' + escAttr(h.url) + '" class="text-ink no-underline after:absolute after:inset-0 after:z-10 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ink">' + esc(h.name) + '</a></h3>';
		if (h.rating !== null && h.rating !== undefined && Number(h.rating) > 0) {
			html += '<span class="rating-badge" aria-label="Hodnocení ' + escAttr(fmtRating(h.rating)) + ' z 10">' + esc(fmtRating(h.rating)) + '</span>';
		}
		html += '</div>';

		html += '<p class="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">';
		if (h.country_flag_url) {
			// SVG vlajka (emoji vlajky Windows nezobrazuje — renderuje jen "EG")
			html += '<img src="' + esc(h.country_flag_url) + '" alt="" class="shrink-0" style="width:18px;height:13.5px;border-radius:2px;object-fit:cover" loading="lazy">';
		} else if (h.country_flag) {
			html += '<span class="shrink-0 text-base leading-none" aria-hidden="true">' + esc(h.country_flag) + '</span>';
		}
		html += '<span class="truncate">' + esc(h.country) + (h.destination ? ' · ' + esc(h.destination) : '') + '</span>';
		if (stars > 0) {
			html += '<span class="ml-auto inline-flex shrink-0 items-center gap-px text-amber-400" role="img" aria-label="' + stars + ' z 5 hvězdiček">';
			for (var i = 0; i < stars; i++) {
				html += STAR_SVG;
			}
			html += '</span>';
		}
		html += '</p>';

		if (best) {
			var bits = [fmtDate(best.departure_date), nightsLabel(best.nights), best.meal_label || ''];
			if (best.airport) {
				bits.push('odlet ' + best.airport);
			}
			html += '<p class="text-sm text-slate-500">' + esc(bits.filter(Boolean).join(' · ')) + '</p>';
		}

		html += '<div class="mt-auto pt-2">';
		if (price !== null && price !== undefined) {
			html += '<p class="text-[15px] text-ink"><span class="text-slate-500">od</span> <strong class="whitespace-nowrap font-extrabold">' + esc(fmtPrice(price)) + '</strong> <span class="text-slate-500">/ os.</span>';
			if (priceOriginal !== null) {
				html += ' <span class="ml-1 whitespace-nowrap text-sm text-slate-400 line-through">' + esc(fmtPrice(priceOriginal)) + '</span>';
			}
			html += '</p>';
		}
		if (partners > 1) {
			html += '<p class="text-sm font-semibold text-coral-dark">Porovnat ' + partners + ' ' + (partners >= 5 ? 'nabídek' : 'nabídky') + '</p>';
		}
		html += '</div></div></article>';

		return html;
	}

	function totalLabel(total) {
		if (total === 1) {
			return 'nalezen 1 hotel';
		}
		if (total >= 2 && total <= 4) {
			return 'nalezeny ' + total + ' hotely';
		}
		return 'nalezeno ' + priceFmt.format(total) + ' hotelů';
	}

	// ------------------------------------------------------ Alpine komponenty

	document.addEventListener('alpine:init', function () {

		/**
		 * Listing: fasety + AJAX přepis gridu + URL sync.
		 */
		Alpine.data('kakapoFilters', function (cfg) {
			cfg = cfg || {};
			return {
				open: false,
				loading: false,
				sort: cfg.sort || 'price',
				total: cfg.total || 0,
				q: cfg.q || '',
				adults: cfg.adults || 0,
				pathFilters: cfg.pathFilters || {},
				activeCount: 0,
				lastQuery: null,

				init: function () {
					this.activeCount = this.countActive();
				},

				/** Hodnoty formuláře faset — vícenásobné checkboxy jako CSV. */
				formValues: function () {
					var out = {};
					var form = this.$refs.form;
					if (!form) {
						return out;
					}
					var fd = new FormData(form);
					fd.forEach(function (v, k) {
						var val = String(v).trim();
						if (val === '') {
							return;
						}
						out[k] = out[k] ? out[k] + ',' + val : val;
					});
					return out;
				},

				countActive: function () {
					var vals = this.formValues();
					var self = this;
					return Object.keys(vals).filter(function (k) {
						// filtry dané cestou landing stránky nepočítat jako aktivní
						var pathVal = self.pathFilters[k];
						if (pathVal !== undefined) {
							var pv = Array.isArray(pathVal) ? pathVal.join(',') : String(pathVal);
							return pv !== vals[k];
						}
						return true;
					}).length;
				},

				/** Parametry pro REST — path filtry + formulář (formulář vyhrává). */
				restParams: function () {
					var params = {};
					var pf = this.pathFilters;
					Object.keys(pf).forEach(function (k) {
						params[k] = Array.isArray(pf[k]) ? pf[k].join(',') : String(pf[k]);
					});
					Object.assign(params, this.formValues());
					if (this.q) {
						params.q = this.q;
					}
					if (this.adults) {
						params.adults = this.adults;
					}
					params.sort = this.sort;
					return params;
				},

				/** Query string do adresního řádku — bez hodnot implikovaných cestou a defaultů. */
				urlQuery: function (params) {
					var out = new URLSearchParams();
					var pf = this.pathFilters;
					Object.keys(params).forEach(function (k) {
						var pathVal = pf[k];
						if (pathVal !== undefined) {
							var pv = Array.isArray(pathVal) ? pathVal.join(',') : String(pathVal);
							if (pv === params[k]) {
								return;
							}
						}
						if (k === 'sort' && params[k] === 'price') {
							return;
						}
						out.set(k, params[k]);
					});
					return out.toString();
				},

				showSkeleton: function () {
					var tpl = document.getElementById('kakapo-skeleton');
					if (tpl && this.$refs.grid) {
						this.$refs.grid.innerHTML = tpl.innerHTML;
					}
				},

				apply: function () {
					var self = this;
					var params = this.restParams();
					var qs = new URLSearchParams(params).toString();
					if (qs === this.lastQuery) {
						return;
					}
					this.lastQuery = qs;
					this.activeCount = this.countActive();
					this.loading = true;
					this.showSkeleton();

					Promise.all([
						fetch(window.KAKAPO.rest + '/search?' + qs).then(function (r) { return r.json(); }),
						fetch(window.KAKAPO.rest + '/filters?' + qs).then(function (r) { return r.json(); })
					]).then(function (res) {
						var search = res[0] || {};
						self.total = search.total || 0;
						self.renderGrid(search.hotels || []);
						self.renderPagination(search.pages || 0, search.page || 1, params);
						self.updateCount();
						self.updateFacets(res[1] || {});
						self.updateUrl(params);
					}).catch(function () {
						// při chybě AJAXu klasická navigace se stejnými filtry
						var fallback = self.urlQuery(params);
						window.location.search = fallback ? '?' + fallback : '';
					}).finally(function () {
						self.loading = false;
					});
				},

				renderGrid: function (hotels) {
					if (!this.$refs.grid) {
						return;
					}
					if (!hotels.length) {
						this.$refs.grid.innerHTML =
							'<div class="col-span-full rounded-3xl bg-paper p-8 text-center sm:p-12">' +
							'<p class="text-lg font-semibold text-ink">Této kombinaci nic neodpovídá</p>' +
							'<p class="mx-auto mt-1 max-w-md text-sm text-slate-500">Zkuste zrušit filtry nebo rozšířit termín odletu — dovolenou tu najdete vždy.</p>' +
							'<div class="mt-5 flex flex-wrap items-center justify-center gap-2">' +
							'<a href="' + location.pathname + '" class="btn-primary btn-sm">Zrušit filtry</a>' +
							'<a href="/last-minute/" class="btn-ghost btn-sm">Last minute nabídky</a>' +
							'</div></div>';
						return;
					}
					this.$refs.grid.innerHTML = hotels.map(renderCard).join('');
				},

				updateCount: function () {
					if (this.$refs.count) {
						this.$refs.count.textContent = totalLabel(this.total);
					}
				},

				/** Přepsání počtů u faset podle REST /filters. */
				updateFacets: function (facets) {
					var counts = {};
					['countries', 'destinations', 'stars', 'meals', 'airports', 'partners', 'nights'].forEach(function (group) {
						(facets[group] || []).forEach(function (row) {
							var key = row.slug !== undefined ? row.slug : row.value;
							counts[group + ':' + key] = parseInt(row.cnt, 10) || 0;
						});
					});
					this.$root.querySelectorAll('[data-facet]').forEach(function (el) {
						var key = el.getAttribute('data-facet');
						el.textContent = '(' + (counts[key] !== undefined ? counts[key] : 0) + ')';
					});
				},

				/** Stránkování po AJAXu — odkazy = plná navigace (SEO-safe). */
				renderPagination: function (pages, page, params) {
					var nav = this.$refs.pagination;
					if (!nav) {
						return;
					}
					if (pages <= 1) {
						nav.innerHTML = '';
						return;
					}
					var qs = this.urlQuery(params);
					var base = window.location.pathname;
					var link = function (n) {
						var p = new URLSearchParams(qs);
						if (n > 1) {
							p.set('strana', n);
						}
						var s = p.toString();
						return base + (s ? '?' + s : '');
					};
					// Okno musí být 1:1 s PHP v templates/search.php (~ř. 408):
					// 1 … p-2..p+2 … dekadické skoky … poslední.
					var items = [1, pages];
					for (var n = Math.max(2, page - 2); n <= Math.min(pages - 1, page + 2); n++) {
						items.push(n);
					}
					for (var j = 10; j < pages; j += 10) {
						items.push(j);
					}
					items = items
						.filter(function (v, i, a) { return a.indexOf(v) === i && v >= 1 && v <= pages; })
						.sort(function (a, b) { return a - b; });

					var html = '';
					if (page > 1) {
						html += '<a class="page-link" href="' + escAttr(link(page - 1)) + '" aria-label="Předchozí stránka">‹</a>';
					}
					var prev = 0;
					items.forEach(function (n) {
						if (n - prev > 1) {
							html += '<span class="px-1 text-slate-400" aria-hidden="true">…</span>';
						}
						prev = n;
						if (n === page) {
							html += '<span class="page-link page-link-active" aria-current="page">' + n + '</span>';
						} else {
							html += '<a class="page-link" href="' + escAttr(link(n)) + '">' + n + '</a>';
						}
					});
					if (page < pages) {
						html += '<a class="page-link" href="' + escAttr(link(page + 1)) + '" aria-label="Další stránka">›</a>';
					}
					nav.innerHTML = html;
				},

				updateUrl: function (params) {
					var qs = this.urlQuery(params);
					window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
				},

				resetFilters: function () {
					var form = this.$refs.form;
					if (!form) {
						return;
					}
					Array.prototype.forEach.call(form.elements, function (el) {
						if (el.type === 'checkbox') {
							el.checked = false;
						} else if (el.type === 'radio') {
							el.checked = el.value === '';
						} else if (el.tagName === 'INPUT') {
							el.value = '';
						}
					});
					this.apply();
				}
			};
		});

		/**
		 * Detail hotelu: tabulka nabídek s AJAX řazením.
		 */
		Alpine.data('kakapoOffers', function (cfg) {
			cfg = cfg || {};
			return {
				hotelId: cfg.id || 0,
				partners: cfg.partners || {},
				colors: cfg.colors || {},
				logos: cfg.logos || {},
				sort: 'price',
				month: '',
				offers: [],
				loaded: false,
				loading: false,

				fetchOffers: function () {
					var self = this;
					if (this.loading || !this.hotelId) {
						return;
					}
					this.loading = true;
					var url = window.KAKAPO.rest + '/hotels/' + this.hotelId + '/offers?sort=' + encodeURIComponent(this.sort);
					if (this.month) {
						url += '&month=' + encodeURIComponent(this.month);
					}
					fetch(url)
						.then(function (r) { return r.json(); })
						.then(function (data) {
							self.offers = (data && data.offers) || [];
							self.loaded = true;
						})
						.catch(function () { /* ponechat server-rendered řádky */ })
						.finally(function () {
							self.loading = false;
						});
				},

				sortBy: function (s) {
					this.sort = s;
					this.fetchOffers();
				},

				/** Chip „Kdy je nejlevněji" — filtr nabídek na měsíc odletu. */
				filterMonth: function (ym) {
					this.month = ym || '';
					this.fetchOffers();
				},

				partnerLabel: function (slug) {
					if (this.partners[slug]) {
						return this.partners[slug];
					}
					return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : '';
				},

				/** Brand barva CK pro iniciálový badge (fallback šedá). */
				partnerColor: function (slug) {
					return this.colors[slug] || '#64748b';
				},

				/** Iniciála CK do kruhového badge. */
				partnerInitial: function (slug) {
					var label = this.partnerLabel(slug);
					return label ? label.charAt(0).toUpperCase() : '?';
				},

				/** URL loga CK ('' = fallback na barevný badge s iniciálou). */
				partnerLogo: function (slug) {
					return this.logos[slug] || '';
				},

				/** Termín „19. 10. – 24. 10. 2026" — rok u odletu jen když se liší. */
				term: function (o) {
					if (!o.return_date) {
						return fmtDate(o.departure_date);
					}
					var d = new Date(String(o.departure_date) + 'T00:00:00');
					var r = new Date(String(o.return_date) + 'T00:00:00');
					if (isNaN(d.getTime()) || isNaN(r.getTime())) {
						return fmtDate(o.departure_date) + ' – ' + fmtDate(o.return_date);
					}
					var dep = d.getDate() + '. ' + (d.getMonth() + 1) + '.' + (d.getFullYear() !== r.getFullYear() ? ' ' + d.getFullYear() : '');
					return dep + ' – ' + fmtDate(o.return_date);
				},

				price: fmtPrice,
				nightsLabel: nightsLabel
			};
		});

		/**
		 * Galerie na detailu hotelu + jednoduchý lightbox.
		 */
		Alpine.data('kakapoGallery', function (cfg) {
			cfg = cfg || {};
			return {
				images: cfg.images || [],
				name: cfg.name || '',
				idx: 0,
				lightbox: false,

				next: function () {
					if (this.images.length) {
						this.idx = (this.idx + 1) % this.images.length;
					}
				},
				prev: function () {
					if (this.images.length) {
						this.idx = (this.idx - 1 + this.images.length) % this.images.length;
					}
				}
			};
		});

		/**
		 * Searchbar: závislý select destinací + mapování počtu nocí.
		 */
		Alpine.data('kakapoSearchbar', function (cfg) {
			cfg = cfg || {};
			return {
				country: cfg.country || '',
				dest: cfg.dest || '',
				nights: cfg.nights || '',
				dests: cfg.dests || {},
				more: false,

				get destOptions() {
					var d = this.dests[this.country] || {};
					return Object.keys(d).map(function (slug) {
						return { slug: slug, label: d[slug] };
					});
				},

				get nightsMin() {
					return { '3-5': 3, '6-8': 6, '9-12': 9, '13': 13 }[this.nights] || '';
				},

				get nightsMax() {
					return { '3-5': 5, '6-8': 8, '9-12': 12 }[this.nights] || '';
				}
			};
		});

		/**
		 * Obecný off-canvas / toggle panel.
		 */
		Alpine.data('kakapoOffcanvas', function () {
			return { open: false };
		});
	});
})();
