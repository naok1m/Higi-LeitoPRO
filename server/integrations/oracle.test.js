import assert from 'node:assert/strict';
import test from 'node:test';
import { isOracleAdHocBedAvailable } from './oracle.js';

test('only MV occupied beds without an open ad-hoc request are available', () => {
  assert.equal(isOracleAdHocBedAvailable({
    SITUACAO_LEITO: 'OCUPADO',
    CD_SOLIC_AVULSA_ABERTA: null,
  }), true);
  assert.equal(isOracleAdHocBedAvailable({
    SITUACAO_LEITO: 'OCUPADO (INFECCAO)',
    CD_SOLIC_AVULSA_ABERTA: null,
  }), true);
  assert.equal(isOracleAdHocBedAvailable({
    SITUACAO_LEITO: 'OCUPADO',
    CD_SOLIC_AVULSA_ABERTA: 1234,
  }), false);
  assert.equal(isOracleAdHocBedAvailable({
    SITUACAO_LEITO: 'VAGO',
    CD_SOLIC_AVULSA_ABERTA: null,
  }), false);
});
