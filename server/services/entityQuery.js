import { ApiError } from '../http/errors.js';

const compareCondition = (actual, expected) => {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return actual === expected;
  return Object.entries(expected).every(([operator, value]) => {
    switch (operator) {
      case '$gt': return actual > value;
      case '$gte': return actual >= value;
      case '$lt': return actual < value;
      case '$lte': return actual <= value;
      case '$ne': return actual !== value;
      case '$in': return Array.isArray(value) && value.includes(actual);
      default: throw new ApiError(400, 'unsupported_query', `Operador de consulta não suportado: ${operator}`);
    }
  });
};

export const matchesQuery = (record, query = {}) =>
  query && typeof query === 'object' && !Array.isArray(query)
    && Object.entries(query).every(([field, expected]) => compareCondition(record[field], expected));

export const sortRecords = (records, sort, numeric = false) => {
  if (!sort) return records;
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  return [...records].sort((left, right) => {
    const a = left[field];
    const b = right[field];
    const comparison = numeric
      ? Number(a) - Number(b)
      : a == null ? (b == null ? 0 : -1) : b == null ? 1 : String(a).localeCompare(String(b), undefined, { numeric: true });
    return descending ? -comparison : comparison;
  });
};

export const aggregateRecords = (records, { query = {}, groupBy, sum = [], avg = [], min = [], max = [], sort, limit } = {}) => {
  if (![sum, avg, min, max].every(Array.isArray)) {
    throw new ApiError(400, 'invalid_aggregate', 'Os campos de agregação devem ser listas.');
  }
  const filtered = records.filter((record) => matchesQuery(record, query));
  const groups = new Map();
  for (const record of filtered) {
    const key = groupBy ? record[groupBy] ?? null : null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  let rows = [...groups.entries()].map(([key, group]) => {
    const row = groupBy ? { [groupBy]: key } : {};
    row.count = group.length;
    for (const field of sum) {
      row[`sum_${field}`] = group.reduce((total, item) => total + (Number(item[field]) || 0), 0);
    }
    for (const field of avg) {
      const values = group.map((item) => Number(item[field])).filter(Number.isFinite);
      row[`avg_${field}`] = values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
    }
    for (const field of min) {
      const values = group.map((item) => Number(item[field])).filter(Number.isFinite);
      row[`min_${field}`] = values.length ? Math.min(...values) : null;
    }
    for (const field of max) {
      const values = group.map((item) => Number(item[field])).filter(Number.isFinite);
      row[`max_${field}`] = values.length ? Math.max(...values) : null;
    }
    return row;
  });
  rows = sortRecords(rows, sort, true);
  if (Number.isFinite(limit)) rows = rows.slice(0, Math.max(0, limit));
  return { rows };
};
