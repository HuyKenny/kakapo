import { exportDb } from '../d1';
import { rebuildSnapshots } from '../../../src/lib/snapshots';
const t = Date.now(); const e = exportDb(); if (!e) throw new Error('no export');
console.log('offers', e.raw.prepare('select count(*) c from offers').get(), Date.now() - t, 'ms');
const r = await rebuildSnapshots(e.db);
console.log(Object.keys(r.registry.countries).length, 'countries;', Object.keys(r.registry.airports).join(','));
