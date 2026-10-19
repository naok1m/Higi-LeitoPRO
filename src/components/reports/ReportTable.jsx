import { isValidElement, useEffect, useState } from 'react';
import { Download, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const plainText = (value) => {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (Array.isArray(value)) return value.map(plainText).join('');
  if (isValidElement(value)) return plainText(value.props.children);
  return String(value);
};

export default function ReportTable({
  columns,
  rows,
  loading,
  empty = 'Sem dados no período.',
  summaryRows = [],
  period = null,
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [expanded]);

  const exportCsv = () => {
    const escape = (value) => `"${String(value).replaceAll('"', '""')}"`;
    const lines = [
      ...(period ? [
        ['Período', period.from || 'Início', period.to || 'Até hoje'].map(escape).join(';'),
        '',
      ] : []),
      ...summaryRows.map((row) => row.map(escape).join(';')),
      ...(summaryRows.length ? [''] : []),
      columns.map((column) => escape(column.label)).join(';'),
      ...rows.map((row, index) => columns
        .map((column) => escape(plainText(column.exportValue
          ? column.exportValue(row, index)
          : column.render(row, index))))
        .join(';')),
    ];
    const file = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = period
      ? `higi-leito-relatorio-${period.from || 'inicio'}-${period.to || 'hoje'}.csv`
      : `higi-leito-relatorio-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (loading) return <p className="text-slate-500 text-sm">Carregando...</p>;
  if (!rows.length) return <p className="text-slate-500 text-sm">{empty}</p>;
  return (
    <>
      <div className="mb-2 flex justify-end gap-2 print:hidden">
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download />
          Exportar Excel (CSV)
        </Button>
        <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
          <Maximize2 />
          Expandir relatório
        </Button>
      </div>
      <div className={`${expanded ? 'report-table-expanded fixed inset-2 z-[100] flex flex-col rounded-2xl border bg-white p-3 shadow-2xl sm:inset-4 sm:p-5' : 'report-table-wrapper rounded-2xl border bg-white'}`}>
        {expanded && (
          <div className="mb-3 flex shrink-0 items-center justify-between print:hidden">
            <p className="text-sm font-medium text-slate-700">Visualização expandida do relatório</p>
            <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
              <Minimize2 />
              Recolher
            </Button>
          </div>
        )}
        <div className={`${expanded ? 'report-table-scroll min-h-0 flex-1 overflow-auto' : 'report-table-wrapper hidden overflow-x-auto md:block'}`}>
          <table className={`report-table text-sm ${expanded ? 'w-max min-w-full table-auto' : 'w-full min-w-[1100px] table-auto'}`}>
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>{columns.map((c) => <th key={c.label} className={`min-w-24 whitespace-normal px-3 py-3 ${c.right ? 'text-right' : 'text-left'}`}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  {columns.map((c) => <td key={c.label} className={`min-w-24 whitespace-normal break-words px-3 py-3 ${c.right ? 'text-right font-mono tabular-nums' : ''}`}>{c.render(r, i)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!expanded && (
          <div className="divide-y md:hidden">
            {rows.map((row, rowIndex) => (
              <article key={row.id || rowIndex} className="space-y-2 p-4">
                {columns.map((column) => (
                  <div key={column.label} className="flex items-start justify-between gap-4 text-sm">
                    <span className="shrink-0 text-slate-500">{column.label}</span>
                    <span className={`min-w-0 text-right ${column.right ? 'font-mono tabular-nums' : 'break-words'}`}>
                      {column.render(row, rowIndex)}
                    </span>
                  </div>
                ))}
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}