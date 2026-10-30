import { RegistroEntregas } from '../../../application/services/registro_entregas.js';
import { EntregarEvento } from '../../../application/use-cases/entregar_evento.use-case.js';
import type { EventoTiempoReal } from '../../../domain/eventos.js';
import { CanalTiempoReal } from '../../../domain/services/canal_tiempo_real.js';

class CanalMemoria extends CanalTiempoReal {
  readonly emitidos: { salas: readonly string[]; evento: EventoTiempoReal }[] =
    [];

  emitir(salas: readonly string[], evento: EventoTiempoReal): void {
    this.emitidos.push({ salas, evento });
  }
}

describe('EntregarEvento', () => {
  const envio = {
    id: '3c1d5e7f-2a4b-4c6d-8e9f-0a1b2c3d4e5f',
    tipo: 'emergencia.creada' as const,
    ocurridoEn: '2026-10-24T15:00:00.000Z',
    salas: ['central'],
    datos: { emergencia: { id: 'e1' } },
  };
  let canal: CanalMemoria;
  let entregar: EntregarEvento;

  beforeEach(() => {
    canal = new CanalMemoria();
    entregar = new EntregarEvento(canal, new RegistroEntregas());
  });

  it('emite a las salas indicadas sin mandar las salas al cliente', () => {
    expect(entregar.ejecutar(envio)).toBe('entregado');

    expect(canal.emitidos).toEqual([
      {
        salas: ['central'],
        evento: {
          id: envio.id,
          tipo: envio.tipo,
          ocurridoEn: envio.ocurridoEn,
          datos: envio.datos,
        },
      },
    ]);
  });

  it('un reintento de la API no se entrega dos veces', () => {
    entregar.ejecutar(envio);

    expect(entregar.ejecutar(envio)).toBe('duplicado');
    expect(canal.emitidos).toHaveLength(1);
  });
});
