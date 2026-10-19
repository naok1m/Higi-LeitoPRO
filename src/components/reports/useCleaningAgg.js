import { db } from '@/api/localClient';

import { useQuery } from '@tanstack/react-query';

export function periodQuery(period) {
  const q = { status: 'concluida' };
  if (period?.from || period?.to) {
    q.finished_at = {};
    if (period.from) q.finished_at.$gte = new Date(`${period.from}T00:00:00`).toISOString();
    if (period.to) q.finished_at.$lte = new Date(`${period.to}T23:59:59.999`).toISOString();
  }
  return q;
}

export default function useCleaningAgg(groupBy, period) {
  return useQuery({
    queryKey: ['report-agg', groupBy, period],
    queryFn: async () => {
      const res = await db.entities.CleaningTask.aggregate({
        query: periodQuery(period), groupBy,
        sum: ['duration_seconds'], avg: ['duration_seconds'], min: ['duration_seconds'], max: ['duration_seconds'],
        sort: '-count', limit: 200,
      });
      return res.rows || [];
    },
  });
}