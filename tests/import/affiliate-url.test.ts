import { describe, expect, it } from 'vitest';
import { buildAffiliateUrl } from '../../workers/import/src/adapters/normalize';

const SLEVOMAT = 'utm_source=affiliate&utm_medium=cpc&utm_campaign=dis_akv_gen_cze_all_buy_q6q55khb_KAKAPOCZ&utm_content=dovolena&utm_term=q6q55khb';
describe('buildAffiliateUrl', () => {
  it('puts query params before the #fragment (Slevomat deeplinks)', () => {
    expect(buildAffiliateUrl('https://www.slevomat.cz/akce/2364302-sardinie#14123326', SLEVOMAT))
      .toBe(`https://www.slevomat.cz/akce/2364302-sardinie?${SLEVOMAT}#14123326`);
  });
  it('appends with & when the deeplink already has a query', () => {
    expect(buildAffiliateUrl('https://x.cz/a?b=1#f', 'a_box=uyvpbj5j')).toBe('https://x.cz/a?b=1&a_box=uyvpbj5j#f');
  });
  it('wraps into a {url} template (network redirectors), keeping the fragment inside the encoded url', () => {
    expect(buildAffiliateUrl('https://x.cz/a#f', 'https://t.example/click?o=1&deep_link={url}')).toBe('https://t.example/click?o=1&deep_link=https%3A%2F%2Fx.cz%2Fa%23f');
  });
  it('plain deeplink without params is unchanged', () => {
    expect(buildAffiliateUrl('https://x.cz/a', '')).toBe('https://x.cz/a');
  });
});
