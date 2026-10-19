import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatDuration } from '@/components/beds/Timer';

const colors = { operation: '#087f8c', idle: '#f59e0b' };

export default function TimeCompositionChart({ title, operationSeconds = 0, idleSeconds = 0 }) {
  const total = operationSeconds + idleSeconds;
  const operationPercent = total ? operationSeconds / total * 100 : 0;
  const idlePercent = total ? idleSeconds / total * 100 : 0;
  const data = [
    { name: 'Operação', value: operationSeconds, color: colors.operation },
    { name: 'Ociosidade', value: idleSeconds, color: colors.idle },
  ].filter((item) => item.value > 0);

  return (
    <section className="rounded-2xl border bg-white p-4">
      <h3 className="font-medium">{title}</h3>
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Sem durações registradas no período.</p>
      ) : (
        <>
          <div className="h-56">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={2}>
                  {data.map((item) => <Cell key={item.name} fill={item.color} />)}
                </Pie>
                <Tooltip formatter={(value, name) => {
                  const duration = Number(value) || 0;
                  return [`${formatDuration(duration)} · ${(duration / total * 100).toFixed(1)}%`, name];
                }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-cyan-50 p-3">
              <p className="text-slate-600">Operação</p>
              <p className="font-semibold text-cyan-900">{operationPercent.toFixed(1)}% · {formatDuration(operationSeconds)}</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-3">
              <p className="text-slate-600">Ociosidade</p>
              <p className="font-semibold text-amber-900">{idlePercent.toFixed(1)}% · {formatDuration(idleSeconds)}</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
