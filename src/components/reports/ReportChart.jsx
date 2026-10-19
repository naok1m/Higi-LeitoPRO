import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function ReportChart({
  title,
  color = '#086986',
  horizontal = false,
  format = (value) => value,
  rows = [],
}) {
  const formatValue = (value) => (format ? format(value) : value);

  return (
    <section className="bg-white rounded-2xl border p-4 space-y-3">
      <h3 className="font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Sem dados para exibir.</p>
      ) : (
        <div style={{ width: '100%', height: horizontal ? Math.max(220, rows.length * 42) : 280 }}>
          <ResponsiveContainer>
            <BarChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              {horizontal ? (
                <>
                  <XAxis type="number" tickFormatter={formatValue} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                </>
              ) : (
                <>
                  <XAxis dataKey="name" interval="preserveStartEnd" angle={rows.length > 5 ? -25 : 0} textAnchor={rows.length > 5 ? 'end' : 'middle'} height={rows.length > 5 ? 70 : 30} tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={formatValue} width={48} tick={{ fontSize: 11 }} />
                </>
              )}
              <Tooltip formatter={formatValue} />
              <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
