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
