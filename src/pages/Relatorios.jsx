import { useState } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import ProductivityReport from '@/components/reports/ProductivityReport';
import WaitingReport from '@/components/reports/WaitingReport';
import TimeReport from '@/components/reports/TimeReport';
import PerformanceReport from '@/components/reports/PerformanceReport';
import ProcessReport from '@/components/reports/ProcessReport';

const dateInputValue = (date) => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
};

export default function Relatorios() {
  const today = new Date();
  const [period, setPeriod] = useState({
    from: dateInputValue(new Date(today.getTime() - 29 * 86400000)),
    to: dateInputValue(today),
  });
  const [report, setReport] = useState('prod');
  const validPeriod = period.from <= period.to;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Relatórios</h2>
        <Button variant="outline" className="h-10 print:hidden" onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" />Imprimir / PDF</Button>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-4 print:hidden">
        <label className="grid gap-1 text-sm text-slate-600">
          De
          <input type="date" value={period.from} max={period.to}
            onChange={(event) => setPeriod((previous) => ({ ...previous, from: event.target.value }))}
            className="h-10 rounded-md border px-3 text-slate-900" />
        </label>
        <label className="grid gap-1 text-sm text-slate-600">
          Até
          <input type="date" value={period.to} min={period.from}
            onChange={(event) => setPeriod((previous) => ({ ...previous, to: event.target.value }))}
            className="h-10 rounded-md border px-3 text-slate-900" />
        </label>
        {!validPeriod && <p role="alert" className="text-sm text-red-700">A data inicial deve ser anterior ou igual à data final.</p>}
      </div>
      <p className="text-sm text-slate-500">
        Período selecionado: {period.from} a {period.to}
      </p>
      <Tabs value={report} onValueChange={setReport}>
        <div className="overflow-x-auto print:hidden">
          <TabsList className="w-max">
            <TabsTrigger value="prod">Produtividade</TabsTrigger>
            <TabsTrigger value="wait">Aguardando limpeza</TabsTrigger>
            <TabsTrigger value="time">Tempo da hotelaria</TabsTrigger>
            <TabsTrigger value="process">Processos e tempos</TabsTrigger>
            <TabsTrigger value="best">Melhor desempenho</TabsTrigger>
            <TabsTrigger value="worst">Pior desempenho</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="prod"><ProductivityReport period={period} /></TabsContent>
        <TabsContent value="wait"><WaitingReport /></TabsContent>
        <TabsContent value="time"><TimeReport period={period} /></TabsContent>
        <TabsContent value="process"><ProcessReport period={period} /></TabsContent>
        <TabsContent value="best"><PerformanceReport period={period} mode="best" /></TabsContent>
        <TabsContent value="worst"><PerformanceReport period={period} mode="worst" /></TabsContent>
      </Tabs>
    </div>
  );
}