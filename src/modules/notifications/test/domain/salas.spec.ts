import {
  PATRON_SALA,
  SALA_CENTRAL,
  salasPermitidas,
} from '../../domain/salas.js';

describe('salas', () => {
  const usuarioId = '0f8e2a4c-5b1d-4c3e-9a7f-1d2c3b4a5e6f';

  it('la central es solo para administradores y despachadores', () => {
    expect(salasPermitidas(usuarioId, 'despachador')).toContain(SALA_CENTRAL);
    expect(salasPermitidas(usuarioId, 'administrador')).toContain(SALA_CENTRAL);
    expect(salasPermitidas(usuarioId, 'conductor')).not.toContain(SALA_CENTRAL);
    expect(salasPermitidas(usuarioId, 'paramedico')).not.toContain(
      SALA_CENTRAL,
    );
  });

  it('cada persona entra solo a su propia sala', () => {
    expect(salasPermitidas(usuarioId, 'conductor')).toEqual([
      `usuario:${usuarioId}`,
    ]);
  });

  it('el ciudadano nunca entra a la central', () => {
    expect(salasPermitidas(usuarioId, 'ciudadano')).toEqual([
      `usuario:${usuarioId}`,
    ]);
  });

  it('solo acepta como destino salas conocidas', () => {
    expect(PATRON_SALA.test('central')).toBe(true);
    expect(PATRON_SALA.test(`usuario:${usuarioId}`)).toBe(true);
    expect(PATRON_SALA.test('usuario:*')).toBe(false);
    expect(PATRON_SALA.test('ambulancias')).toBe(false);
  });
});
