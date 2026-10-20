export const companies = [
  { id: '1', name: 'Otoclínica', oracleCode: 1 },
  { id: '18', name: 'Gastroclínica', oracleCode: 18 },
  { id: '19', name: 'São Mateus', oracleCode: 19 },
];

export const companyById = new Map(companies.map((company) => [company.id, company]));

export const supportedOracleCompanyCodes = companies.map(({ oracleCode }) => oracleCode);
