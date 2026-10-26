// GA4 with Consent Mode v2 (default denied, granted from localStorage). Same event names as the WordPress plugin.
const KEY = 'kakapo_consent';
export function ga4Head(id: string, pageType: string): string {
  if (!/^G-[A-Z0-9]{6,}$/i.test(id)) return '';
  const src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
  return `<script id="kakapo-ga4-consent">
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
(function(){var g='denied';try{if(localStorage.getItem('${KEY}')==='1'){g='granted';}}catch(e){}
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:g,functionality_storage:'granted',security_storage:'granted',wait_for_update:500});})();
gtag('js',new Date());
gtag('config','${id}',{page_type:'${pageType}'});
</script>
<script id="kakapo-ga4">
(function(){var d=0;function go(){if(d)return;d=1;var s=document.createElement('script');s.async=true;s.src=${JSON.stringify(src)};document.head.appendChild(s);}
['pointerdown','keydown','scroll','touchstart'].forEach(function(e){addEventListener(e,go,{once:true,passive:true});});
addEventListener('load',function(){if('requestIdleCallback' in window){requestIdleCallback(go,{timeout:3000});}else{setTimeout(go,2000);}});})();
</script>`;
}
export function ga4Footer(id: string, pageType: string): string {
  if (!/^G-[A-Z0-9]{6,}$/i.test(id)) return '';
  return `<div id="kakapo-consent" class="kakapo-consent" style="display:none" role="dialog" aria-live="polite" aria-label="Souhlas s měřením návštěvnosti">
	<p class="kakapo-consent__t">Měříme návštěvnost, ať víme, které stránky lidem pomáhají. Bez souhlasu měříme jen anonymně, bez cookies.</p>
	<div class="kakapo-consent__b">
		<button type="button" data-kakapo-consent="1" class="kakapo-consent__yes">Souhlasím</button>
		<button type="button" data-kakapo-consent="0" class="kakapo-consent__no">Jen nezbytné</button>
		<a href="/ochrana-osobnich-udaju/" class="kakapo-consent__l">Více</a>
	</div>
</div>
<style>
.kakapo-consent{position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:60;max-width:36rem;margin-inline:auto;background:#fff;border:1px solid #EBE7E1;border-radius:1.5rem;box-shadow:0 8px 28px rgba(31,35,40,.14);padding:1.1rem 1.25rem;font-size:.875rem;line-height:1.5;color:#3F3B36}
.kakapo-consent__t{margin:0 0 .75rem}
.kakapo-consent__b{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}
.kakapo-consent button{cursor:pointer;border-radius:999px;padding:.55rem 1.1rem;font-weight:600;font-size:.875rem;border:1px solid transparent}
.kakapo-consent__yes{background:#1F2328;color:#fff}
.kakapo-consent__no{background:#fff;color:#1F2328;border-color:#D4D0CA}
.kakapo-consent__l{margin-left:auto;color:#56514B;font-size:.8125rem}
</style>
<script id="kakapo-ga4-events">
(function(){
	var KEY='${KEY}';
	var PT='${pageType}';
	function store(k,v){try{localStorage.setItem(k,v);}catch(e){}}
	function read(k){try{return localStorage.getItem(k);}catch(e){return null;}}
	var box=document.getElementById('kakapo-consent');
	if(box&&read(KEY)===null){box.style.display='';}
	if(box){
		box.addEventListener('click',function(e){
			var b=e.target.closest('[data-kakapo-consent]');
			if(!b){return;}
			var yes=b.getAttribute('data-kakapo-consent')==='1';
			store(KEY,yes?'1':'0');
			if(window.gtag){gtag('consent','update',{analytics_storage:yes?'granted':'denied'});}
			box.style.display='none';
		});
	}
	document.addEventListener('click',function(e){
		if(!e.target||!e.target.closest){return;}
		var a=e.target.closest('a[href]');
		if(!a){return;}
		var u;try{u=new URL(a.getAttribute('href'),location.href);}catch(err){return;}
		var same=u.host===location.host;
		var viaGo=same&&/^\\/(go|akce)\\//.test(u.pathname);
		if(!viaGo&&same){return;}
		if(!window.gtag){return;}
		gtag('event','affiliate_click',{
			page_type:PT,
			link_kind:viaGo?'go':'direct',
			partner:a.getAttribute('data-kakapo-partner')||(viaGo?'':u.host),
			destination:viaGo?u.pathname:u.host,
			context:u.searchParams.get('ctx')||'',
			value:parseInt(a.getAttribute('data-kakapo-price')||'0',10)||0,
			currency:'CZK'
		});
	},true);
})();
</script>`;
}
