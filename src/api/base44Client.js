// Higi Leito PRO - Banco de Dados Local e Cliente Standalone (sem dependência do Base44)

const STORAGE_PREFIX = 'higi_leito_';

const initialUnits = [
  { id: 'u1', name: 'UTI Adulto - Bloco A', code: 'UTI-A' },
  { id: 'u2', name: 'UTI Coronariana', code: 'UTI-COR' },
  { id: 'u3', name: 'Enfermaria Geral 3º Andar', code: 'ENF-3' },
  { id: 'u4', name: 'Centro Cirúrgico - RPA', code: 'RPA' },
  { id: 'u5', name: 'Pronto Socorro - Observação', code: 'PS-OBS' }
];

const initialBeds = [
  { id: 'b1', code: 'UTI-01', unit_id: 'u1', unit_name: 'UTI Adulto - Bloco A', status: 'ocupado', missing_count: 0, missing_items: '', updated_date: new Date(Date.now() - 3600000).toISOString() },
  { id: 'b2', code: 'UTI-02', unit_id: 'u1', unit_name: 'UTI Adulto - Bloco A', status: 'aguardando_limpeza', missing_count: 0, missing_items: '', updated_date: new Date(Date.now() - 1500000).toISOString() },
  { id: 'b3', code: 'UTI-03', unit_id: 'u1', unit_name: 'UTI Adulto - Bloco A', status: 'em_limpeza', missing_count: 0, missing_items: '', updated_date: new Date(Date.now() - 800000).toISOString() },
  { id: 'b4', code: 'UTI-04', unit_id: 'u1', unit_name: 'UTI Adulto - Bloco A', status: 'livre', missing_count: 0, missing_items: '', updated_date: new Date(Date.now() - 7200000).toISOString() },
  { id: 'b5', code: 'COR-01', unit_id: 'u2', unit_name: 'UTI Coronariana', status: 'livre', missing_count: 0, missing_items: '', updated_date: new Date(Date.now() - 5400000).toISOString() },
  { id: 'b6', code: 'COR-02', unit_id: 'u2', unit_name: 'UTI Coronariana', status: 'aguardando_limpeza', missing_count: 0, missing_items: '', updated_date: new Date(Date.now() - 2400000).toISOString() },
  { id: 'b7', code: 'ENF-301', unit_id: 'u3', unit_name: 'Enfermaria Geral 3º Andar', status: 'ocupado', missing_count: 0, missing_items: '', updated_date: new Date(Date.now() - 86400000).toISOString() },
  { id: 'b8', code: 'ENF-302', unit_id: 'u3', unit_name: 'Enfermaria Geral 3º Andar', status: 'livre', missing_count: 0, missing_items: '', updated_date: new Date(Date.now() - 1800000).toISOString() },
  { id: 'b9', code: 'RPA-01', unit_id: 'u4', unit_name: 'Centro Cirúrgico - RPA', status: 'livre', missing_count: 0, missing_items: '', updated_date: new Date(Date.now() - 4000000).toISOString() },
  { id: 'b10', code: 'PS-01', unit_id: 'u5', unit_name: 'Pronto Socorro - Observação', status: 'aguardando_limpeza', missing_count: 0, missing_items: '', updated_date: new Date(Date.now() - 600000).toISOString() }
];

const initialEmployees = [
  { id: 'e1', name: 'Maria das Graças Silva', registration: '4501', role: 'Auxiliar de higienização', shift: 'manha', phone: '(11) 98765-4321', active: true },
  { id: 'e2', name: 'Carlos Eduardo Santos', registration: '4502', role: 'Higienista Hospitalar', shift: 'tarde', phone: '(11) 97654-3210', active: true },
  { id: 'e3', name: 'Ana Paula Ferreira', registration: '4503', role: 'Auxiliar de higienização', shift: 'noite', phone: '(11) 96543-2109', active: true },
  { id: 'e4', name: 'Roberto Lima', registration: '4504', role: 'Líder de Higiene', shift: 'manha', phone: '(11) 95432-1098', active: true }
];

const initialMaterials = [
  { id: 'm1', name: 'Lençol de Cama Hospitalar', category: 'Enxoval', expected_quantity: 2, active: true },
  { id: 'm2', name: 'Fronha Impermeável', category: 'Enxoval', expected_quantity: 2, active: true },
  { id: 'm3', name: 'Travesseiro Selado', category: 'Enxoval', expected_quantity: 1, active: true },
  { id: 'm4', name: 'Cobertor Antialérgico', category: 'Enxoval', expected_quantity: 1, active: true },
  { id: 'm5', name: 'Suporte de Soro (Inox)', category: 'Equipamento', expected_quantity: 1, active: true },
  { id: 'm6', name: 'Campainha de Chamada', category: 'Acessório', expected_quantity: 1, active: true },
  { id: 'm7', name: 'Comadre / Papagaio Higienizado', category: 'Utensílio', expected_quantity: 1, active: true }
];

const initialTasks = [
  {
    id: 't1',
    bed_id: 'b3',
    bed_code: 'UTI-03',
    unit_name: 'UTI Adulto - Bloco A',
    employee_id: 'e1',
    employee_name: 'Maria das Graças Silva',
    cleaning_type: 'terminal',
    status: 'em_andamento',
    started_at: new Date(Date.now() - 12 * 60000).toISOString(),
    mv_sync_status: 'pendente'
  },
  {
    id: 't2',
    bed_id: 'b1',
    bed_code: 'UTI-01',
    unit_name: 'UTI Adulto - Bloco A',
    employee_id: 'e1',
    employee_name: 'Maria das Graças Silva',
    cleaning_type: 'terminal',
    status: 'concluida',
    started_at: new Date(Date.now() - 120 * 60000).toISOString(),
    finished_at: new Date(Date.now() - 95 * 60000).toISOString(),
    duration_seconds: 1500,
    mv_sync_status: 'enviado'
  },
  {
    id: 't3',
    bed_id: 'b4',
    bed_code: 'UTI-04',
    unit_name: 'UTI Adulto - Bloco A',
    employee_id: 'e2',
    employee_name: 'Carlos Eduardo Santos',
    cleaning_type: 'concorrente',
    status: 'concluida',
    started_at: new Date(Date.now() - 300 * 60000).toISOString(),
    finished_at: new Date(Date.now() - 280 * 60000).toISOString(),
    duration_seconds: 1200,
    mv_sync_status: 'enviado'
  },
  {
    id: 't4',
    bed_id: 'b8',
    bed_code: 'ENF-302',
    unit_name: 'Enfermaria Geral 3º Andar',
    employee_id: 'e3',
    employee_name: 'Ana Paula Ferreira',
    cleaning_type: 'terminal',
    status: 'concluida',
    started_at: new Date(Date.now() - 500 * 60000).toISOString(),
    finished_at: new Date(Date.now() - 472 * 60000).toISOString(),
    duration_seconds: 1680,
    mv_sync_status: 'enviado'
  }
];

const initialDataMap = {
  Unit: initialUnits,
  Bed: initialBeds,
  Employee: initialEmployees,
  Material: initialMaterials,
  CleaningTask: initialTasks,
  MaterialCheck: [],
  User: []
};

class LocalEntityStore {
  constructor(entityName) {
    this.name = entityName;
    this.storageKey = `${STORAGE_PREFIX}${entityName}`;
  }

  _getItems() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return initialDataMap[this.name] || [];
      }
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) {
        const seed = initialDataMap[this.name] || [];
        window.localStorage.setItem(this.storageKey, JSON.stringify(seed));
        return seed;
      }
      return JSON.parse(raw);
    } catch {
      return initialDataMap[this.name] || [];
    }
  }

  _saveItems(items) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(this.storageKey, JSON.stringify(items));
      }
    } catch (e) {
      console.warn('Erro ao salvar no localStorage:', e);
    }
  }

  async filter(query = {}, options = {}) {
    const items = this._getItems();
    let result = items.filter((item) => {
      for (const [k, v] of Object.entries(query)) {
        if (v && typeof v === 'object' && '$gte' in v) {
          const itemVal = item[k];
          if (!itemVal || new Date(itemVal) < new Date(v.$gte)) return false;
        } else if (item[k] !== v) {
          return false;
        }
      }
      return true;
    });

    if (options.sort) {
      const isDesc = options.sort.startsWith('-');
      const field = isDesc ? options.sort.slice(1) : options.sort;
      result.sort((a, b) => {
        const valA = a[field] ?? '';
        const valB = b[field] ?? '';
        if (valA < valB) return isDesc ? 1 : -1;
        if (valA > valB) return isDesc ? -1 : 1;
        return 0;
      });
    }

    if (options.limit && options.limit > 0) {
      result = result.slice(0, options.limit);
    }

    // Retorna array enriquecido com .items para compatibilidade dupla
    result.items = [...result];
    result.total = result.length;
    return result;
  }

  async get(id) {
    const items = this._getItems();
    return items.find((i) => i.id === id) || null;
  }

  async create(data) {
    const items = this._getItems();
    const newItem = {
      ...data,
      id: data.id || 'id_' + Math.random().toString(36).substr(2, 9),
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    items.push(newItem);
    this._saveItems(items);
    return newItem;
  }

  async update(id, updates) {
    const items = this._getItems();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) {
      // Se não encontrou, cria se tiver id
      const newItem = { id, ...updates, updated_date: new Date().toISOString() };
      items.push(newItem);
      this._saveItems(items);
      return newItem;
    }
    items[idx] = {
      ...items[idx],
      ...updates,
      updated_date: new Date().toISOString()
    };
    this._saveItems(items);
    return items[idx];
  }

  async delete(id) {
    let items = this._getItems();
    items = items.filter((i) => i.id !== id);
    this._saveItems(items);
    return true;
  }

  async aggregate(options = {}) {
    const items = await this.filter(options.query || {});
    const groupBy = options.groupBy;

    if (!groupBy) {
      // Agregação global (sem agrupamento)
      let sumDur = 0;
      let count = 0;
      items.forEach((item) => {
        if (typeof item.duration_seconds === 'number') {
          sumDur += item.duration_seconds;
          count++;
        }
      });
      const avgDur = count ? Math.round(sumDur / count) : 0;
      return {
        rows: [
          {
            count: items.length,
            sum_duration_seconds: sumDur,
            avg_duration_seconds: avgDur
          }
        ]
      };
    }

    const groups = {};
    items.forEach((item) => {
      const key = item[groupBy] || 'Outros';
      if (!groups[key]) {
        groups[key] = {
          [groupBy]: key,
          count: 0,
          sum_duration_seconds: 0,
          durations: []
        };
      }
      groups[key].count++;
      if (typeof item.duration_seconds === 'number') {
        groups[key].sum_duration_seconds += item.duration_seconds;
        groups[key].durations.push(item.duration_seconds);
      }
    });

    const rows = Object.values(groups).map((g) => {
      const avg = g.durations.length ? Math.round(g.sum_duration_seconds / g.durations.length) : 0;
      const min = g.durations.length ? Math.min(...g.durations) : 0;
      const max = g.durations.length ? Math.max(...g.durations) : 0;
      return {
        ...g,
        avg_duration_seconds: avg,
        min_duration_seconds: min,
        max_duration_seconds: max
      };
    });

    return { rows };
  }
}

const entityStores = {};
const entitiesProxy = new Proxy(
  {},
  {
    get: (_, entityName) => {
      if (!entityStores[entityName]) {
        entityStores[entityName] = new LocalEntityStore(entityName);
      }
      return entityStores[entityName];
    }
  }
);

export const db = {
  app: {
    getPublicSettings: async () => ({
      id: 'higi-leito-pro',
      public_settings: {
        name: 'Higi Leito PRO',
        description: 'Sistema Avançado de Gestão de Higienização de Leitos'
      }
    })
  },
  auth: {
    isAuthenticated: async () => true,
    me: async () => ({
      id: 'usr_admin',
      name: 'Administrador Hospitalar',
      email: 'admin@hospital.com',
      role: 'admin'
    }),
    loginViaEmailPassword: async (email, password) => {
      const user = {
        id: 'usr_admin',
        name: 'Administrador Hospitalar',
        email: email || 'admin@hospital.com',
        role: 'admin'
      };
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('higi_leito_user', JSON.stringify(user));
      }
      return user;
    },
    loginWithProvider: (provider, returnTo) => {
      if (typeof window !== 'undefined') {
        window.location.href = returnTo || '/';
      }
    },
    logout: (returnUrl) => {
      if (typeof window !== 'undefined') {
        if (window.localStorage) {
          window.localStorage.removeItem('higi_leito_user');
          window.localStorage.removeItem('token');
          window.localStorage.removeItem('base44_access_token');
        }
        window.location.href = returnUrl || '/login';
      }
    },
    redirectToLogin: (returnUrl) => {
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
  },
  entities: entitiesProxy,
  integrations: {
    Core: {
      UploadFile: async (file) => ({
        file_url: typeof URL !== 'undefined' ? URL.createObjectURL(file) : ''
      })
    }
  }
};

// Configura globalmente para retrocompatibilidade total com qualquer componente
if (typeof globalThis !== 'undefined') {
  globalThis.__B44_DB__ = db;
}

export const base44 = db;
export default db;