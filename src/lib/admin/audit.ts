import type { Sql } from './sql';
export async function audit(db: Sql, actor: string, action: string, target = '', detail = ''): Promise<void> {
  await db.run('INSERT INTO admin_audit (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)', [new Date().toISOString(), actor.slice(0, 200), action, target.slice(0, 300), detail.slice(0, 2000)]);
}
