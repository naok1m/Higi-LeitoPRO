import oracledb from 'oracledb';

const cleaningBedsQuery = `
  select cd_leito,
         ds_leito,
         ds_enfermaria,
         sn_extra,
         tipo_acomodacao,
         cd_unid_int,
         unidade_internacao,
         cd_setor,
         setor,
         cd_solic_limpeza,
         tp_solicitacao,
         ds_tipo_limpeza,
         dh_solicitacao,
         etapa_mv
    from ygor_hubce.vw_higienizacao_leitos
   where cd_multi_empresa = :empresa
   order by dh_solicitacao
`;

const dischargeForecastQuery = `
  select cd_leito,
         ds_leito,
         sn_alta_medica,
         cd_atendimento,
         dh_alta_medica,
         situacao_alta
    from ygor_hubce.vw_higienizacao_agendamentos
   where cd_multi_empresa = :empresa
   order by dh_alta_medica
`;

const occupiedBedsQuery = `
  select cd_leito,
         ds_leito,
         ds_enfermaria,
         tipo_acomodacao,
         cd_unid_int,
         unidade_internacao,
         setor,
         situacao_leito,
         cd_atendimento,
         cd_solic_avulsa_aberta
    from ygor_hubce.vw_higi_leitos_ocupados
   where cd_multi_empresa = :empresa
   order by unidade_internacao, ds_leito
`;

let config = null;
let poolPromise = null;
let thickModeInitialized = false;

export const configureOracleIntegration = (env) => {
  const user = env.HIGI_ORACLE_USER?.trim();
  const password = env.HIGI_ORACLE_PASSWORD;
  const connectString = env.HIGI_ORACLE_CONNECT_STRING?.trim();
  const clientLibDir = env.HIGI_ORACLE_CLIENT_LIB_DIR?.trim();
  const companyCodes = (env.HIGI_ORACLE_COMPANIES || env.HIGI_ORACLE_COMPANY || '1,18,19')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
  const requestedIntervalMs = Number(env.HIGI_ORACLE_POLL_INTERVAL_MS || 2000);
  const intervalMs = Number.isInteger(requestedIntervalMs) && requestedIntervalMs >= 2000
    ? requestedIntervalMs
    : 2000;

  config = user && password && connectString && companyCodes.length > 0
    && companyCodes.every((code) => /^\d+$/.test(code))
    ? { user, password, connectString, clientLibDir, companyCodes: [...new Set(companyCodes.map(Number))], intervalMs }
    : null;
};

export const isOracleConfigured = () => Boolean(config);

export const getOraclePollIntervalMs = () => config?.intervalMs || 2000;

export const getOracleCompanyCode = () => config?.companyCodes[0] || null;
export const getOracleCompanyCodes = () => config?.companyCodes || [];

const initializeThickMode = () => {
  if (thickModeInitialized) return;
  try {
    oracledb.initOracleClient(config.clientLibDir ? { libDir: config.clientLibDir } : {});
    thickModeInitialized = true;
  } catch (error) {
    throw new Error(
      `Não foi possível iniciar o Oracle Thick mode. Instale o Oracle Instant Client compatível com o Node.js e configure HIGI_ORACLE_CLIENT_LIB_DIR para a pasta que contém OCI.dll. ${error.message}`,
      { cause: error },
    );
  }
};

const getPool = async () => {
  if (!config) throw new Error('A conexão Oracle não está configurada no computador host.');
  if (!poolPromise) {
    initializeThickMode();
    poolPromise = oracledb.createPool({
      user: config.user,
      password: config.password,
      connectString: config.connectString,
      poolMin: 1,
      poolMax: 2,
      poolIncrement: 1,
    }).catch((error) => {
      poolPromise = null;
      throw error;
    });
  }
  return poolPromise;
};

export const fetchOracleCleaningBeds = async (companyCode) => {
  if (!config?.companyCodes.includes(Number(companyCode))) {
    throw new Error('A empresa solicitada não está habilitada na integração Oracle.');
  }
  const pool = await getPool();
  const connection = await pool.getConnection();
  // Uma consulta travada no Oracle não pode parar a sincronização para sempre.
  connection.callTimeout = 30000;
  try {
    const result = await connection.execute(
      cleaningBedsQuery,
      { empresa: Number(companyCode) },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return result.rows || [];
  } finally {
    await connection.close();
  }
};

export const fetchOracleDischargeForecast = async (companyCode) => {
  if (!config?.companyCodes.includes(Number(companyCode))) {
    throw new Error('A empresa solicitada não está habilitada na integração Oracle.');
  }
  const pool = await getPool();
  const connection = await pool.getConnection();
  connection.callTimeout = 30000;
  try {
    const result = await connection.execute(
      dischargeForecastQuery,
      { empresa: Number(companyCode) },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return result.rows || [];
  } finally {
    await connection.close();
  }
};

export const isOracleAdHocBedAvailable = (bed) => {
  const bedSituation = String(bed?.SITUACAO_LEITO || '').trim().toLocaleUpperCase('pt-BR');
  return ['OCUPADO', 'OCUPADO (INFECCAO)'].includes(bedSituation)
    && (bed.CD_SOLIC_AVULSA_ABERTA === null || bed.CD_SOLIC_AVULSA_ABERTA === undefined);
};

export const fetchOracleOccupiedBeds = async (companyCode) => {
  if (!config?.companyCodes.includes(Number(companyCode))) {
    throw new Error('A empresa solicitada não está habilitada na integração Oracle.');
  }
  const pool = await getPool();
  const connection = await pool.getConnection();
  connection.callTimeout = 30000;
  try {
    const result = await connection.execute(
      occupiedBedsQuery,
      { empresa: Number(companyCode) },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return result.rows || [];
  } finally {
    await connection.close();
  }
};

export const requestOracleAdHocCleaning = async ({
  companyCode,
  bedCode,
  operatorLogin,
  cleaningType,
  observation,
}) => {
  if (!config?.companyCodes.includes(Number(companyCode))) {
    throw new Error('A empresa solicitada não está habilitada na integração Oracle.');
  }
  if (!Number.isSafeInteger(Number(bedCode)) || Number(bedCode) <= 0 || !operatorLogin?.trim()) {
    throw new Error('O leito e o login do operador são obrigatórios para solicitar a limpeza avulsa.');
  }
  if (cleaningType !== null && ![1, 3].includes(cleaningType)) {
    throw new Error('O tipo de limpeza deve ser terminal (1), concorrente (3) ou não informado.');
  }
  if (typeof observation !== 'string' || observation.length > 1000) {
    throw new Error('A observação deve ter no máximo 1000 caracteres.');
  }

  const pool = await getPool();
  const connection = await pool.getConnection();
  connection.callTimeout = 30000;
  try {
    const result = await connection.execute(
      `declare
         v_cd_solic number;
       begin
         ygor_hubce.prc_solic_avulsa_higienizacao(
           p_cd_multi_empresa => :empresa,
           p_cd_leito => :cd_leito,
           p_nm_usuario => :login_operador,
           p_cd_tipo_limpeza => :cd_tipo_limpeza,
           p_ds_observacao => :observacao,
           p_cd_solic_limpeza => v_cd_solic
         );
         commit;
         :cd_solic_limpeza := v_cd_solic;
       exception
         when others then
           rollback;
           raise;
       end;`,
      {
        empresa: Number(companyCode),
        cd_leito: Number(bedCode),
        login_operador: operatorLogin.trim(),
        cd_tipo_limpeza: { val: cleaningType, type: oracledb.NUMBER },
        observacao: { val: observation.trim() || null, type: oracledb.STRING },
        cd_solic_limpeza: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
    );
    return result.outBinds?.cd_solic_limpeza ?? null;
  } finally {
    await connection.close();
  }
};

export const releaseOracleBed = async (companyCode, bedCode) => {
  if (!config) throw new Error('A conexão Oracle não está configurada no computador host.');
  if (!Number.isInteger(companyCode) || !config.companyCodes.includes(companyCode) || !bedCode) {
    throw new Error('A empresa e o código Oracle do leito são obrigatórios para liberar o leito no MV.');
  }
  const pool = await getPool();
  const connection = await pool.getConnection();
  try {
    await connection.execute(
      `begin
         ygor_hubce.prc_liberar_leito_higienizacao(
           p_cd_multi_empresa => :empresa,
           p_cd_leito => :cd_leito
         );
         commit;
       exception
         when others then
           rollback;
           raise;
       end;`,
      { empresa: companyCode, cd_leito: bedCode },
    );
  } finally {
    await connection.close();
  }
};

export const closeOraclePool = async () => {
  if (!poolPromise) return;
  const pool = await poolPromise;
  poolPromise = null;
  await pool.close(10);
};
