/**
 * Kakapo Travel Engine — frontend (vanilla JS + Alpine.js komponenty).
 *
 * Komponenty: kakapoFilters, kakapoOffers, kakapoGallery, kakapoSearchbar, kakapoOffcanvas.
 * Karty výsledků renderuje src/lib/listing/engine.ts (1:1 s CardHotel.astro) nad statickými /data/zajezdy/*.json.
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

	function esc(s) {
		var div = document.createElement('div');
		div.textContent = s === null || s === undefined ? '' : String(s);
		return div.innerHTML;
	}

	function escAttr(s) {
		return esc(s).replace(/"/g, '&quot;');
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
		 * Listing: fasety + přepis gridu + URL sync. Statický web (Workers assets ignorují query) → výsledky počítá
		 * window.kakapoListing (src/lib/listing/client.ts) nad /data/zajezdy/*.json; data se stahují až při použití
		 * filtru nebo když URL filtr obsahuje. Bez JS zůstává předrenderovaný nefiltrovaný výpis.
		 */
		var LISTING_KEYS = ['country', 'dest', 'q', 'meal', 'stars', 'airport', 'partner', 'price_min', 'price_max', 'rating_min', 'date_from', 'date_to', 'nights_min', 'nights_max', 'adults', 'flag', 'theme', 'transport', 'sort'];

		function listingEngine() {
			if (window.kakapoListing) {
				return Promise.resolve(window.kakapoListing);
			}
			return new Promise(function (resolve, reject) {
				var t = setTimeout(function () { reject(new Error('kakapoListing not loaded')); }, 15000);
				document.addEventListener('kakapo:listing', function () {
					clearTimeout(t);
					resolve(window.kakapoListing);
				}, { once: true });
			});
		}

		Alpine.data('kakapoFilters', function (cfg) {
			cfg = cfg || {};
			return {
				open: false,
				loading: false,
				sort: cfg.sort || 'recommended',
				defaultSort: cfg.sort || 'recommended',
				total: cfg.total || 0,
				q: cfg.q || '',
				adults: cfg.adults || 0,
				pathFilters: cfg.pathFilters || {},
				extra: {},
				page: 1,
				activeCount: 0,
				lastQuery: '',
				initial: null,

				init: function () {
					var self = this;
					var form = this.$refs.form;
					// výchozí stav formuláře (= landing bez GET filtrů), na něj se vrací reset i zpět v historii
					this.initial = form ? Array.prototype.map.call(form.elements, function (el) {
						return [el, el.checked, el.value];
					}) : [];
					this.initialGrid = this.$refs.grid ? this.$refs.grid.innerHTML : '';
					this.initialPager = this.$refs.pagination ? this.$refs.pagination.innerHTML : '';
					this.initialTotal = this.total;
					var robots = document.querySelector('meta[name="robots"]');
					this.robotsMeta = robots;
					this.robotsInitial = robots ? robots.getAttribute('content') : null;
					if (this.syncFromUrl()) {
						this.lastQuery = null;
						this.render(false);
					}
					this.activeCount = this.countActive();
					window.addEventListener('popstate', function () {
						self.syncFromUrl();
						self.render(false);
					});
					if (this.$refs.pagination) {
						// stránkování v místě (odkazy ?strana=N zůstávají pro roboty a bez JS)
						this.$refs.pagination.addEventListener('click', function (e) {
							var a = e.target.closest ? e.target.closest('a[href]') : null;
							if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button > 0) {
								return;
							}
							var n = parseInt(new URL(a.href, window.location.href).searchParams.get('strana') || '1', 10) || 1;
							e.preventDefault();
							self.page = n;
							self.render(true, true);
						});
					}
				},

				/** URL → formulář (statické HTML má vždy výchozí stav landingu). Vrací true, když URL něco filtruje. */
				syncFromUrl: function () {
					var sp = new URLSearchParams(window.location.search);
					var form = this.$refs.form;
					var self = this;
					var any = false;
					(this.initial || []).forEach(function (r) {
						r[0].checked = r[1];
						r[0].value = r[2];
					});
					this.extra = {};
					this.q = '';
					this.adults = 0;
					this.sort = this.defaultSort;
					LISTING_KEYS.forEach(function (k) {
						var v = (sp.get(k) || '').trim();
						if (v === '') {
							return;
						}
						any = true;
						if (k === 'q') {
							self.q = v.slice(0, 100);
							return;
						}
						if (k === 'adults') {
							self.adults = parseInt(v, 10) || 0;
							return;
						}
						if (k === 'sort') {
							var opt = self.$refs.sort ? Array.prototype.some.call(self.$refs.sort.options, function (o) { return o.value === v; }) : false;
							if (opt) {
								self.sort = v;
							}
							return;
						}
						var els = form ? Array.prototype.filter.call(form.elements, function (el) { return el.name === k; }) : [];
						if (!els.length) {
							self.extra[k] = v;
							return;
						}
						var type = els[0].type;
						if (type === 'radio' || type === 'checkbox') {
							var vals = type === 'radio' ? [v] : v.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
							var known = vals.every(function (x) { return els.some(function (el) { return el.value === x; }); });
							els.forEach(function (el) {
								el.checked = known && vals.indexOf(el.value) !== -1;
							});
							if (!known) {
								self.extra[k] = v;
							}
							return;
						}
						els[0].value = v;
					});
					if (this.$refs.sort) {
						this.$refs.sort.value = this.sort;
					}
					this.page = Math.max(1, parseInt(sp.get('strana') || '1', 10) || 1);
					return any || this.page > 1;
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
					}).length + Object.keys(this.extra).length + (this.q ? 1 : 0);
				},

				/** Parametry hledání — path filtry + parametry z URL bez ovládacího prvku + formulář (formulář vyhrává). */
				restParams: function () {
					var params = {};
					var pf = this.pathFilters;
					Object.keys(pf).forEach(function (k) {
						params[k] = Array.isArray(pf[k]) ? pf[k].join(',') : String(pf[k]);
					});
					Object.assign(params, this.extra, this.formValues());
					if (this.q) {
						params.q = this.q;
					}
					if (this.adults) {
						params.adults = String(this.adults);
					}
					params.sort = this.sort;
					return params;
				},

				/** Query string do adresního řádku — bez hodnot implikovaných cestou a defaultů. */
				urlQuery: function (params, page) {
					var out = new URLSearchParams();
					var pf = this.pathFilters;
					var self = this;
					Object.keys(params).forEach(function (k) {
						var pathVal = pf[k];
						if (pathVal !== undefined) {
							var pv = Array.isArray(pathVal) ? pathVal.join(',') : String(pathVal);
							if (pv === params[k]) {
								return;
							}
						}
						if (k === 'sort' && params[k] === self.defaultSort) {
							return;
						}
						out.set(k, params[k]);
					});
					if (page > 1) {
						out.set('strana', String(page));
					}
					return out.toString();
				},

				showSkeleton: function () {
					var tpl = document.getElementById('kakapo-skeleton');
					if (tpl && this.$refs.grid) {
						this.$refs.grid.innerHTML = tpl.innerHTML;
					}
				},

				/** Změna filtru / řazení → první strana. */
				apply: function () {
					this.page = 1;
					this.render(false);
				},

				render: function (push, scroll) {
					var self = this;
					var params = this.restParams();
					var uq = this.urlQuery(params, this.page);
					if (uq === this.lastQuery) {
						return;
					}
					this.lastQuery = uq;
					this.activeCount = this.countActive();
					this.updateUrl(uq, push);
					if (uq === '') {
						// výchozí stav = předrenderovaný výpis, data netřeba
						this.restore();
						return;
					}
					this.loading = true;
					this.showSkeleton();
					var page = this.page;
					listingEngine().then(function (eng) {
						return eng.run(self.pathFilters, params, page, uq);
					}).then(function (res) {
						if (self.lastQuery !== uq) {
							return;
						}
						self.total = res.total || 0;
						self.renderGrid(res.html || '');
						self.renderPagination(res.pages || 0, res.page || 1, params);
						self.updateCount();
						self.updateFacets(res.facets || {});
						if (scroll && self.$refs.grid) {
							self.$refs.grid.scrollIntoView({ block: 'start' });
						}
					}).catch(function (e) {
						if (window.console) {
							console.warn('kakapo: filtry nejsou dostupné', e);
						}
						self.restore();
					}).finally(function () {
						self.loading = false;
					});
				},

				restore: function () {
					if (this.$refs.grid) {
						this.$refs.grid.innerHTML = this.initialGrid;
					}
					if (this.$refs.pagination) {
						this.$refs.pagination.innerHTML = this.initialPager;
					}
					this.total = this.initialTotal;
					this.updateCount();
				},

				renderGrid: function (html) {
					if (!this.$refs.grid) {
						return;
					}
					if (!html) {
						this.$refs.grid.innerHTML =
							'<div class="col-span-full rounded-3xl bg-paper p-8 text-center sm:p-12">' +
							'<p class="text-lg font-semibold text-ink">Této kombinaci nic neodpovídá</p>' +
							'<p class="mx-auto mt-1 max-w-md text-sm text-slate-500">Zkuste zrušit filtry nebo rozšířit termín odletu — dovolenou tu najdete vždy.</p>' +
							'<div class="mt-5 flex flex-wrap items-center justify-center gap-2">' +
							'<a href="' + escAttr(location.pathname) + '" class="btn-primary btn-sm">Zrušit filtry</a>' +
							'<a href="/last-minute/" class="btn-ghost btn-sm">Last minute nabídky</a>' +
							'</div></div>';
						return;
					}
					this.$refs.grid.innerHTML = html;
				},

				updateCount: function () {
					if (this.$refs.count) {
						this.$refs.count.textContent = totalLabel(this.total);
					}
				},

				/** Počty u faset (skupiny, které klient spočítal; ostatní zůstávají ze statického HTML). */
				updateFacets: function (facets) {
					var groups = facets.groups || [];
					var counts = facets.counts || {};
					this.$root.querySelectorAll('[data-facet]').forEach(function (el) {
						var key = el.getAttribute('data-facet');
						if (groups.indexOf(key.split(':')[0]) === -1) {
							return;
						}
						el.textContent = '(' + (counts[key] !== undefined ? counts[key] : 0) + ')';
					});
				},

				/** Stránkování — markup 1:1 s Listing.astro; odkazy ?strana=N, klik se obslouží v místě. */
				renderPagination: function (pages, page, params) {
					var nav = this.$refs.pagination;
					if (!nav) {
						return;
					}
					if (pages <= 1) {
						nav.innerHTML = '';
						return;
					}
					var self = this;
					var base = window.location.pathname;
					var link = function (n) {
						var s = self.urlQuery(params, n);
						return base + (s ? '?' + s : '');
					};
					var arrow = function (d) {
						return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
					};
					// 1 … p-2..p+2 … dekadické skoky … poslední (jako Listing.astro)
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
						html += '<a class="page-link" href="' + escAttr(link(page - 1)) + '" aria-label="Předchozí stránka">' + arrow('m15 18-6-6 6-6') + '</a>';
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
						html += '<a class="page-link" href="' + escAttr(link(page + 1)) + '" aria-label="Další stránka">' + arrow('m9 18 6-6-6-6') + '</a>';
					}
					nav.innerHTML = html;
				},

				/** Adresní řádek; filtrovaný stav není k indexaci (canonical zůstává čistá URL landingu). */
				updateUrl: function (qs, push) {
					// parametry mimo filtry (utm_*, gclid…) v adrese zůstávají
					var out = new URLSearchParams(qs);
					new URLSearchParams(window.location.search).forEach(function (v, k) {
						if (LISTING_KEYS.indexOf(k) === -1 && k !== 'strana') {
							out.append(k, v);
						}
					});
					var s = out.toString();
					var url = window.location.pathname + (s ? '?' + s : '');
					if (url !== window.location.pathname + window.location.search) {
						window.history[push ? 'pushState' : 'replaceState'](null, '', url);
					}
					if (this.robotsMeta && this.robotsInitial !== null) {
						this.robotsMeta.setAttribute('content', qs ? 'noindex, follow' : this.robotsInitial);
					}
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
					this.extra = {};
					this.q = '';
					this.adults = 0;
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
