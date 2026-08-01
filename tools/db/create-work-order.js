const pool = require('./client');
const { checkReincidence } = require('./check-reincidence');
const { createReincidence } = require('./create-reincidence');

async function createWorkOrder({ nombreCliente, telefono, placa, servicio, fecha, tecnico,
  tiempoEstimado, kilometraje, descripcionProblema, trabajos, repuestos, notas,
  cedularuc, direccionCliente, tieneClave, claveCodigo, nivelGasolina,
  horaLlegada, danosDescripcion, repuestosDetalle, serviciosDetalle, manoDeObra, tipoServicio, tipoVehiculo }) {

  const reinc = await checkReincidence({ telefono, placa });

  const { rows } = await pool.query(
    `INSERT INTO citas
       (nombre_cliente, telefono, servicio_solicitado, fecha, estado,
        kilometraje, descripcion_problema, trabajos, repuestos,
        tecnico, tiempo_estimado, estado_orden, notas,
        cedula_ruc, direccion_cliente, tiene_clave, clave_codigo, nivel_gasolina,
        hora_llegada, danos_descripcion, repuestos_detalle, servicios_detalle, mano_de_obra, tipo_servicio, tipo_vehiculo)
     VALUES ($1,$2,$3,$4,'Pendiente',$5,$6,$7,$8,$9,$10,'Borrador',$11,
             $12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21,$22,$23)
     RETURNING *`,
    [nombreCliente, telefono, servicio, fecha,
     kilometraje || null, descripcionProblema || null,
     trabajos || null, repuestos || null,
     tecnico || null, tiempoEstimado || null, notas || null,
     cedularuc || null, direccionCliente || null,
     tieneClave || false, claveCodigo || null, nivelGasolina || '1/2',
     horaLlegada || null, danosDescripcion || null,
     JSON.stringify(repuestosDetalle || []), JSON.stringify(serviciosDetalle || []),
     manoDeObra || null, tipoServicio || null, tipoVehiculo || null]
  );
  const orden = rows[0];

  if (tecnico && tiempoEstimado && fecha) {
    try {
      const { blockTechnicianSlots } = require('./block-technician-slots');
      await blockTechnicianSlots({ tecnico, fecha, horasEstimadas: tiempoEstimado, citaId: orden.id });
    } catch (e) {
      console.warn('[work-order] No se pudieron bloquear slots:', e.message);
    }
  }

  if (reinc) {
    const { rows: existing } = await pool.query(
      'SELECT id FROM reincidencias WHERE cita_regreso_id = $1 LIMIT 1',
      [orden.id]
    );
    if (!existing.length) {
      await createReincidence({
        placa, telefono, clienteNombre: nombreCliente,
        tecnico, trabajoOriginal: reinc.servicio_solicitado,
        fechaOriginal: reinc.fecha, fechaRegreso: fecha,
        citaOriginalId: reinc.id, citaRegresoId: orden.id,
      });
    }
  }

  return {
    id: orden.id,
    nombreCliente: orden.nombre_cliente,
    telefono: orden.telefono,
    servicio: orden.servicio_solicitado,
    fecha: orden.fecha,
    tecnico: orden.tecnico,
    estadoOrden: orden.estado_orden,
  };
}

module.exports = { createWorkOrder };
