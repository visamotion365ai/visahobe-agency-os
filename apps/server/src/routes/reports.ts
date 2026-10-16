import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';
import { camelizeAll } from '../lib/rows.js';

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/reports/summary', { preHandler: app.requireAuth }, async () => {
    const db = getDb();
    const [applicants, cases, documents, sponsors, conversations] = await Promise.all([
      db.get('SELECT COUNT(*) AS c FROM applicants'),
      db.get('SELECT COUNT(*) AS c FROM visa_cases'),
      db.get('SELECT COUNT(*) AS c FROM documents'),
      db.get('SELECT COUNT(*) AS c FROM sponsors'),
      db.get('SELECT COUNT(*) AS c FROM conversations'),
    ]);
    const byCountry = await db.all(
      'SELECT country, COUNT(*) AS count FROM visa_cases GROUP BY country ORDER BY count DESC',
    );
    const byStep = await db.all(
      `SELECT current_step AS step, COUNT(*) AS count FROM visa_cases WHERE status = 'active' GROUP BY current_step ORDER BY current_step`,
    );
    const bySponsorStatus = await db.all(
      'SELECT verification_status AS status, COUNT(*) AS count FROM sponsors GROUP BY verification_status',
    );
    const recentCases = await db.all(
      `SELECT c.id, c.reference, c.country, c.visa_category, c.status, c.current_step, c.created_at, a.full_name
         FROM visa_cases c JOIN applicants a ON a.id = c.applicant_id
        ORDER BY c.created_at DESC LIMIT 8`,
    );
    const docByCategory = await db.all(
      'SELECT category, COUNT(*) AS count FROM documents GROUP BY category ORDER BY count DESC LIMIT 12',
    );
    return {
      totals: {
        applicants: Number(applicants?.c ?? 0),
        cases: Number(cases?.c ?? 0),
        documents: Number(documents?.c ?? 0),
        sponsors: Number(sponsors?.c ?? 0),
        conversations: Number(conversations?.c ?? 0),
      },
      byCountry: camelizeAll(byCountry),
      byStep: camelizeAll(byStep),
      bySponsorStatus: camelizeAll(bySponsorStatus),
      docByCategory: camelizeAll(docByCategory),
      recentCases: camelizeAll(recentCases),
    };
  });
}
