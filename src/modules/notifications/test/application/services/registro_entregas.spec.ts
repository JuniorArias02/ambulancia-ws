import {
  RegistroEntregas,
  VENTANA_DEDUPLICACION_MS,
} from '../../../application/services/registro_entregas.js';

describe('RegistroEntregas', () => {
  it('reconoce un evento repetido', () => {
    const registro = new RegistroEntregas();

    expect(registro.registrar('e1', 0)).toBe(true);
    expect(registro.registrar('e1', 1_000)).toBe(false);
    expect(registro.registrar('e2', 1_000)).toBe(true);
  });

  it('olvida los eventos fuera de la ventana', () => {
    const registro = new RegistroEntregas();
    registro.registrar('e1', 0);

    expect(registro.registrar('e1', VENTANA_DEDUPLICACION_MS)).toBe(true);
  });
});
