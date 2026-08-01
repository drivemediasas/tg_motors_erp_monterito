const express    = require('express');
const router     = express.Router();
const rateLimit  = require('express-rate-limit');
const pool       = require('../../tools/db/client');
const { searchClient }     = require('../../tools/db/search-client');
const { getClientHistory } = require('../../tools/db/get-client-history');
const { createWorkOrder }  = require('../../tools/db/create-work-order');
const { sendOrder }        = require('../../tools/whatsapp/send-order');
const { sendMessage }      = require('../../tools/whatsapp/send-message');
const { sendCompletion }   = require('../../tools/whatsapp/send-completion');
const { updateAppointment }= require('../../tools/db/update-appointment');
const { getClient }        = require('../../tools/db/get-client');
const crypto               = require('crypto');

// ── Sesiones con expiración de 8 horas ───────────────────────────────────────
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8h en ms
const sessions    = new Map();
const loginAttempts = new Map(); // anti-brute-force por IP

// Limpieza automática de sesiones expiradas cada hora
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now > s.expiresAt) sessions.delete(token);
  }
  for (const [ip, a] of loginAttempts) {
    if (now > a.lockedUntil && a.count === 0) loginAttempts.delete(ip);
  }
}, 60 * 60 * 1000);

function generateToken() { return crypto.randomBytes(32).toString('hex'); }

// ── Login — anti-fuerza-bruta + sin creds hardcodeadas ────────────────────────
router.post('/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const attempt = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };

  if (Date.now() < attempt.lockedUntil) {
    const mins = Math.ceil((attempt.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ error: `Demasiados intentos. Espera ${mins} minuto(s).` });
  }

  const validEmail    = process.env.DASHBOARD_EMAIL;
  const validPassword = process.env.DASHBOARD_PASSWORD;

  if (!validEmail || !validPassword) {
    return res.status(503).json({ error: 'Dashboard no configurado. Contacta al administrador.' });
  }

  const { email, password } = req.body;
  if (email === validEmail && password === validPassword) {
    loginAttempts.delete(ip);
    const token = generateToken();
    sessions.set(token, { email, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL });
    // Cookie httpOnly para cerrar la puerta del panel /admin a quien no tiene sesión.
    res.cookie('tgm_sid', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL,
    });
    return res.json({ token, expiresIn: SESSION_TTL });
  }

  attempt.count = (attempt.count || 0) + 1;
  if (attempt.count >= 5) {
    attempt.lockedUntil = Date.now() + 15 * 60 * 1000;
    attempt.count = 0;
  }
  loginAttempts.set(ip, attempt);
  res.status(401).json({ error: 'Credenciales incorrectas' });
});

// ── Middleware de autenticación ───────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers['x-session-token'];
  const session = token && sessions.get(token);
  if (session) {
    if (Date.now() > session.expiresAt) {
      sessions.delete(token);
      return res.status(401).json({ error: 'Sesión expirada. Inicia sesión de nuevo.' });
    }
    return next();
  }
  res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
}

// Helper para errores — nunca exponer mensajes internos de DB al cliente
function dbError(res, e) {
  console.error('[api]', e.message);
  res.status(500).json({ error: 'Error interno del servidor. Intenta de nuevo.' });
}

router.use(auth);

// ── Clientes ─────────────────────────────────────────────────────────────────

// Crear cliente nuevo
router.post('/clientes', async (req, res) => {
  try {
    const { nombre, telefono, placa, marca, modelo, anio, email, cedula, direccion } = req.body;
    if (!nombre || !telefono) return res.status(400).json({ error: 'Nombre y teléfono son obligatorios' });
    const { rows } = await pool.query(
      `INSERT INTO clientes (nombre, telefono, placa, marca, modelo, anio, email, cedula, direccion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (telefono) DO UPDATE SET
         nombre    = EXCLUDED.nombre,
         placa     = COALESCE(NULLIF(EXCLUDED.placa,''),   clientes.placa),
         marca     = COALESCE(NULLIF(EXCLUDED.marca,''),   clientes.marca),
         modelo    = COALESCE(NULLIF(EXCLUDED.modelo,''),  clientes.modelo),
         anio      = COALESCE(NULLIF(EXCLUDED.anio,''),    clientes.anio),
         email     = COALESCE(NULLIF(EXCLUDED.email,''),   clientes.email),
         cedula    = COALESCE(NULLIF(EXCLUDED.cedula,''),  clientes.cedula),
         direccion = COALESCE(NULLIF(EXCLUDED.direccion,''),clientes.direccion)
       RETURNING *`,
      [nombre, telefono, placa||null, marca||null, modelo||null, anio||null,
       email||null, cedula||null, direccion||null]
    );
    res.json(rows[0]);
  } catch (e) { dbError(res, e); }
});

router.get('/clientes/buscar', async (req, res) => {
  try {
    const results = await searchClient(req.query.q || '');
    res.json(results);
  } catch (e) { dbError(res, e); }
});

// Lista completa paginada y ordenada
router.get('/clientes', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;
    const order  = req.query.order === 'desc' ? 'DESC' : 'ASC';

    const [{ rows }, { rows: total }] = await Promise.all([
      pool.query(
        `SELECT id, nombre, telefono, email, placa, marca, modelo, anio,
                cedula, direccion, fecha_ultimo_servicio::text
         FROM clientes ORDER BY nombre ${order} LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query('SELECT COUNT(*) FROM clientes'),
    ]);
    res.json({ clientes: rows, total: parseInt(total[0].count), page, limit });
  } catch (e) { dbError(res, e); }
});

// Cliente individual (datos autoritativos por id — usado al restaurar/editar órdenes)
router.get('/clientes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, telefono, email, placa, marca, modelo, anio,
              cedula, direccion, fecha_ultimo_servicio::text
       FROM clientes WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(rows[0]);
  } catch (e) { dbError(res, e); }
});

router.get('/clientes/:id/historial', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT telefono FROM clientes WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    const historial = await getClientHistory(rows[0].telefono);
    res.json(historial);
  } catch (e) { dbError(res, e); }
});

// Lista de vehículos de un cliente (multi-vehículo)
router.get('/clientes/:id/vehiculos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, placa, marca, modelo, anio FROM vehiculos WHERE cliente_id = $1 ORDER BY created_at, id',
      [req.params.id]
    );
    if (rows.length) return res.json(rows);
    // Fallback: si aún no hay filas en vehiculos, devolver el vehículo actual del cliente
    const { rows: cl } = await pool.query('SELECT placa, marca, modelo, anio FROM clientes WHERE id = $1', [req.params.id]);
    if (!cl.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    const current = { placa: cl[0].placa, marca: cl[0].marca, modelo: cl[0].modelo, anio: cl[0].anio };
    res.json([current].filter(v => v.placa));
  } catch (e) { dbError(res, e); }
});

// Reemplaza por completo la lista de vehículos de un cliente
router.put('/clientes/:id/vehiculos', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = req.params.id;
    const lista = Array.isArray(req.body.vehiculos) ? req.body.vehiculos : [];
    // Normalizar: descartar filas totalmente vacías
    const limpios = lista
      .map(v => ({
        placa:  (v.placa  || '').trim() || null,
        marca:  (v.marca  || '').trim() || null,
        modelo: (v.modelo || '').trim() || null,
        anio:   (v.anio   || '').toString().trim() || null,
      }))
      .filter(v => v.placa || v.marca || v.modelo || v.anio);

    await client.query('BEGIN');
    await client.query('DELETE FROM vehiculos WHERE cliente_id = $1', [id]);
    for (const v of limpios) {
      await client.query(
        'INSERT INTO vehiculos (cliente_id, placa, marca, modelo, anio) VALUES ($1,$2,$3,$4,$5)',
        [id, v.placa, v.marca, v.modelo, v.anio]
      );
    }
    // Mantener el "vehículo principal" en clientes (compatibilidad con búsqueda y órdenes)
    const principal = limpios[0] || { placa: null, marca: null, modelo: null, anio: null };
    await client.query(
      'UPDATE clientes SET placa=$1, marca=$2, modelo=$3, anio=$4 WHERE id=$5',
      [principal.placa, principal.marca, principal.modelo, principal.anio, id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, count: limpios.length });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    dbError(res, e);
  } finally {
    client.release();
  }
});

// Actualizar email (y otros campos) de un cliente
router.patch('/clientes/:id', async (req, res) => {
  try {
    const allowed = ['email', 'nombre', 'telefono', 'placa', 'marca', 'modelo', 'anio', 'notas', 'cedula', 'direccion'];

    // El teléfono es la identidad única del cliente: si se cambia, verificar que no
    // colisione con otro cliente antes de actualizar.
    if (req.body.telefono) {
      const { rows } = await pool.query(
        'SELECT id FROM clientes WHERE telefono = $1 AND id <> $2 LIMIT 1',
        [req.body.telefono, req.params.id]
      );
      if (rows.length) return res.status(409).json({ error: 'Ya existe otro cliente con ese teléfono.' });
    }

    const sets = [], vals = [];
    let i = 1;
    for (const [key, val] of Object.entries(req.body)) {
      if (allowed.includes(key)) { sets.push(`${key} = $${i}`); vals.push(val); i++; }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    vals.push(req.params.id);
    await pool.query(`UPDATE clientes SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    res.json({ ok: true });
  } catch (e) { dbError(res, e); }
});

// ── Órdenes de trabajo ────────────────────────────────────────────────────────

router.get('/ordenes', async (req, res) => {
  try {
    const estado = req.query.estado || null;
    const desde = req.query.desde || null;
    const hasta = req.query.hasta || null;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (estado) {
      conditions.push(`c.estado_orden = $${paramIndex}`);
      params.push(estado);
      paramIndex++;
    }
    if (desde) {
      conditions.push(`c.fecha >= $${paramIndex}`);
      params.push(desde);
      paramIndex++;
    }
    if (hasta) {
      conditions.push(`c.fecha <= $${paramIndex}`);
      params.push(hasta);
      paramIndex++;
    }

    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const query = `
      SELECT c.id, c.nombre_cliente, c.telefono, c.servicio_solicitado,
              c.fecha::text AS fecha, TO_CHAR(c.hora,'HH24:MI') AS hora,
              c.estado, c.estado_orden, c.tecnico, c.tiempo_estimado,
              c.trabajos, c.descripcion_problema, c.kilometraje, c.created_at::text AS created_at,
              c.repuestos, c.notas, c.cedula_ruc, c.direccion_cliente,
              c.tiene_clave, c.clave_codigo, c.nivel_gasolina, c.danos_descripcion,
              TO_CHAR(c.hora_llegada AT TIME ZONE 'America/Guayaquil','HH24:MI') AS hora_llegada,
              c.repuestos_detalle, c.servicios_detalle, c.mano_de_obra, c.tipo_servicio, c.tipo_vehiculo,
              c.prefactura_items, c.prefactura_servicios, c.prefactura_mano_obra, c.prefactura_notas,
              cl.id AS cliente_id, cl.placa, cl.marca, cl.modelo, cl.anio, cl.cedula, cl.direccion
       FROM citas c
       LEFT JOIN clientes cl ON cl.telefono = c.telefono
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT 100`;

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) { dbError(res, e); }
});

router.get('/ordenes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.nombre_cliente, c.telefono, c.servicio_solicitado,
              c.fecha::text AS fecha, TO_CHAR(c.hora,'HH24:MI') AS hora,
              c.estado, c.estado_orden, c.tecnico, c.tiempo_estimado,
              c.trabajos, c.descripcion_problema, c.kilometraje, c.created_at::text AS created_at,
              c.repuestos, c.notas, c.cedula_ruc, c.direccion_cliente,
              c.tiene_clave, c.clave_codigo, c.nivel_gasolina, c.danos_descripcion,
              TO_CHAR(c.hora_llegada AT TIME ZONE 'America/Guayaquil','HH24:MI') AS hora_llegada,
              c.repuestos_detalle, c.servicios_detalle, c.mano_de_obra, c.tipo_servicio, c.tipo_vehiculo,
              c.prefactura_items, c.prefactura_servicios, c.prefactura_mano_obra, c.prefactura_notas,
              cl.id AS cliente_id, cl.placa, cl.marca, cl.modelo, cl.anio, cl.cedula, cl.direccion
       FROM citas c
       LEFT JOIN clientes cl ON cl.telefono = c.telefono
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json(rows[0]);
  } catch(e) { dbError(res, e); }
});

router.post('/ordenes', async (req, res) => {
  try {
    const b = req.body;
    // Una orden SIEMPRE pertenece a un cliente existente. Sin teléfono o sin cliente
    // registrado, no se crea (evita órdenes huérfanas que no se cruzan con ningún cliente).
    if (!b.telefono) return res.status(400).json({ error: 'Falta el teléfono del cliente.' });
    const cliente = await getClient(b.telefono);
    if (!cliente) return res.status(400).json({ error: 'Cliente no encontrado. Selecciónalo o créalo primero.' });
    // Guardar cédula y dirección en el perfil del cliente si se proporcionan
    if (cliente && (b.cedularuc || b.direccionCliente)) {
      const updates = {};
      if (b.cedularuc) updates.cedula = b.cedularuc;
      if (b.direccionCliente) updates.direccion = b.direccionCliente;
      const sets = Object.keys(updates).map((k, i) => `${k} = $${i+1}`).join(', ');
      await pool.query(`UPDATE clientes SET ${sets} WHERE id = $${Object.keys(updates).length+1}`,
        [...Object.values(updates), cliente.id]);
    }
    const orden = await createWorkOrder({
      nombreCliente:       b.nombreCliente || cliente?.nombre,
      telefono:            b.telefono,
      placa:               b.placa || cliente?.placa,
      servicio:            b.servicio || b.tipoServicio || 'Sin especificar',
      // Fecha LOCAL de Ecuador (UTC-5). Railway corre en UTC: usar toISOString() fecharía las
      // órdenes creadas de noche en el día siguiente. en-CA da formato YYYY-MM-DD.
      fecha:               b.fecha || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' }),
      tecnico:             b.tecnico,
      tiempoEstimado:      b.tiempoEstimado,
      kilometraje:         b.kilometraje,
      descripcionProblema: b.descripcionProblema,
      trabajos:            b.trabajos,
      repuestos:           b.repuestos,
      notas:               b.notas,
      cedularuc:           b.cedularuc,
      direccionCliente:    b.direccionCliente,
      tieneClave:          b.tieneClave,
      claveCodigo:         b.claveCodigo || null,
      nivelGasolina:       b.nivelGasolina,
      horaLlegada:         b.horaLlegada,
      danosDescripcion:    b.danosDescripcion,
      repuestosDetalle:    b.repuestosDetalle,
      serviciosDetalle:    b.serviciosDetalle,
      manoDeObra:          b.manoDeObra,
      tipoServicio:        b.tipoServicio || null,
      tipoVehiculo:        b.tipoVehiculo || null,
    });
    res.json(orden);
  } catch (e) { dbError(res, e); }
});

// Agendar cita simple (owner agenda manualmente desde el calendario)
router.post('/citas', async (req, res) => {
  try {
    const { nombreCliente, telefono, servicio, fecha, hora, tecnico, notas } = req.body;
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });
    const { createAppointment } = require('../../tools/db/create-appointment');
    // Buscar o crear cliente
    let cliente = telefono ? await getClient(telefono) : null;
    if (!cliente && nombreCliente && telefono) {
      const { createClient } = require('../../tools/db/create-client');
      cliente = await createClient({ nombre: nombreCliente, telefono });
    }
    const cita = await createAppointment({
      nombreCliente: nombreCliente || cliente?.nombre || 'Cliente',
      telefono: telefono || '',
      servicio: servicio || 'Cita agendada',
      fecha, hora: hora || null, notas: notas || null,
    });

    // Duración estimada según el tipo de servicio (para que el bot vea disponibilidad)
    const { getServiceDuration } = require('../../tools/db/service-durations');
    const horasEstimadas = getServiceDuration(servicio);

    // Guardar técnico (si se proporcionó) y la duración estimada en la cita
    if (cita.id) {
      await pool.query(
        'UPDATE citas SET tecnico = COALESCE($1, tecnico), tiempo_estimado = $2 WHERE id = $3',
        [tecnico || null, horasEstimadas, cita.id]
      );
    }

    // Si hay técnico, bloquear los slots que ocupa la cita según su duración
    if (tecnico && cita.id) {
      try {
        const { blockTechnicianSlots } = require('../../tools/db/block-technician-slots');
        await blockTechnicianSlots({ tecnico, fecha, horasEstimadas, citaId: cita.id });
      } catch (e) {
        console.warn('[citas] No se pudieron bloquear slots:', e.message);
      }
    }

    res.json({ ...cita, tecnico, tiempoEstimado: horasEstimadas });
  } catch (e) { dbError(res, e); }
});

// Slots de disponibilidad para el calendario
router.get('/disponibilidad', async (req, res) => {
  try {
    const desde = req.query.desde || new Date().toISOString().split('T')[0];
    const hasta = req.query.hasta || (() => { const d = new Date(); d.setDate(d.getDate()+14); return d.toISOString().split('T')[0]; })();
    const { rows } = await pool.query(
      `SELECT fecha::text, TO_CHAR(hora,'HH24:MI') AS hora, disponible, tecnico, cita_id
       FROM disponibilidad
       WHERE fecha >= $1 AND fecha <= $2
       ORDER BY fecha, hora, tecnico`,
      [desde, hasta]
    );
    res.json(rows);
  } catch (e) { dbError(res, e); }
});

// Eliminar orden
router.delete('/ordenes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM reincidencias WHERE cita_original_id=$1 OR cita_regreso_id=$1', [req.params.id]);
    await pool.query('UPDATE disponibilidad SET disponible=true, cita_id=NULL WHERE cita_id=$1', [req.params.id]);
    const { rowCount } = await pool.query('DELETE FROM citas WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json({ ok: true });
  } catch (e) { dbError(res, e); }
});

// Editar orden existente
router.patch('/ordenes/:id', async (req, res) => {
  try {
    const allowed = ['servicio_solicitado','descripcion_problema','trabajos','repuestos',
      'tecnico','tiempo_estimado','kilometraje','notas','estado_orden','cedula_ruc',
      'direccion_cliente','tiene_clave','clave_codigo','nivel_gasolina','danos_descripcion',
      'mano_de_obra','hora_salida','tipo_servicio','tipo_vehiculo','prefactura_mano_obra','prefactura_notas',
      'fecha','hora'];
    const sets = [], vals = [];
    let i = 1;
    for (const [key, val] of Object.entries(req.body)) {
      if (allowed.includes(key)) {
        // La columna en la BD es prefactura_notas (no prefactura_notes)
        sets.push(`${key} = $${i}`);
        vals.push(val);
        i++;
      }
    }
    // repuestos_detalle es especial (jsonb)
    if (req.body.repuestosDetalle !== undefined) {
      sets.push(`repuestos_detalle = $${i}::jsonb`);
      vals.push(JSON.stringify(req.body.repuestosDetalle)); i++;
    }
    // servicios_detalle es especial (jsonb) — desglose de mano de obra
    if (req.body.serviciosDetalle !== undefined) {
      sets.push(`servicios_detalle = $${i}::jsonb`);
      vals.push(JSON.stringify(req.body.serviciosDetalle)); i++;
    }
    if (req.body.manoDeObra !== undefined) {
      sets.push(`mano_de_obra = $${i}`);
      vals.push(req.body.manoDeObra); i++;
    }
    // prefactura_items es especial (jsonb)
    if (req.body.prefacturaItems !== undefined || req.body.prefactura_items !== undefined) {
      const items = req.body.prefacturaItems !== undefined ? req.body.prefacturaItems : req.body.prefactura_items;
      sets.push(`prefactura_items = $${i}::jsonb`);
      vals.push(JSON.stringify(items)); i++;
    }
    // prefactura_servicios es especial (jsonb) — desglose editable de mano de obra en la prefactura
    if (req.body.prefacturaServicios !== undefined || req.body.prefactura_servicios !== undefined) {
      const svc = req.body.prefacturaServicios !== undefined ? req.body.prefacturaServicios : req.body.prefactura_servicios;
      sets.push(`prefactura_servicios = $${i}::jsonb`);
      vals.push(JSON.stringify(svc)); i++;
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });

    // Si la orden pasa a "Completada", avisar al cliente que su vehículo está listo.
    // Solo en la transición real (estado anterior ≠ Completada) para no reenviar.
    // silent=1 (edición rápida desde la tabla) omite el aviso automático por WhatsApp.
    const silent = req.query.silent === '1' || req.query.silent === 'true' || req.body.silent === true;
    let notifyCompletion = null;
    if (req.body.estado_orden === 'Completada' && !silent) {
      const { rows: prev } = await pool.query(
        `SELECT c.estado_orden, c.nombre_cliente, c.telefono,
                cl.placa, cl.marca, cl.modelo
           FROM citas c LEFT JOIN clientes cl ON cl.telefono = c.telefono
          WHERE c.id = $1`, [req.params.id]
      );
      if (prev.length && prev[0].estado_orden !== 'Completada' && prev[0].telefono) {
        notifyCompletion = prev[0];
      }
    }

    vals.push(req.params.id);
    await pool.query(`UPDATE citas SET ${sets.join(', ')} WHERE id = $${i}`, vals);

    if (notifyCompletion) {
      try {
        await sendCompletion({
          nombreCliente: notifyCompletion.nombre_cliente,
          telefono: notifyCompletion.telefono,
          placa: notifyCompletion.placa,
          marca: notifyCompletion.marca,
          modelo: notifyCompletion.modelo,
        });
      } catch (e) { console.warn('[completion] no se pudo avisar al cliente:', e.message); }
    }

    res.json({ ok: true });
  } catch (e) { dbError(res, e); }
});

router.post('/ordenes/:id/enviar', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, cl.placa, cl.marca, cl.modelo, cl.anio
       FROM citas c LEFT JOIN clientes cl ON cl.telefono = c.telefono
       WHERE c.id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Orden no encontrada' });
    const orden = rows[0];

    // Si hay un mensaje personalizado (ej: prefactura), enviar directamente
    if (req.body.customMessage) {
      await sendMessage(orden.telefono, req.body.customMessage);
    } else {
      // Si no, enviar la plantilla estándar de orden de trabajo
      await sendOrder({
        nombreCliente: orden.nombre_cliente, telefono: orden.telefono,
        placa: orden.placa, marca: orden.marca, modelo: orden.modelo, anio: orden.anio,
        kilometraje: orden.kilometraje, descripcionProblema: orden.descripcion_problema,
        trabajos: orden.trabajos, repuestos: orden.repuestos,
        tecnico: orden.tecnico, tiempoEstimado: orden.tiempo_estimado,
      });
    }
    await updateAppointment(req.params.id, { estado_orden: 'Enviada' });
    res.json({ ok: true });
  } catch (e) { dbError(res, e); }
});

// ── Dashboard Financiero ──────────────────────────────────────────────────────
router.get('/stats/finanzas', async (req, res) => {
  try {
    // Solo PREFACTURAS generadas (las órdenes de trabajo no tienen precio confiable).
    // Por prefactura: mano = servicios desglosados (o el lump prefactura_mano_obra);
    //                 rep  = suma de prefactura_items (cantidad * precio).
    const PF_BASE = `
      pf AS (
        SELECT
          fecha,
          COALESCE(
            (SELECT SUM((s->>'precio')::numeric)
             FROM jsonb_array_elements(COALESCE(prefactura_servicios,'[]'::jsonb)) s),
            prefactura_mano_obra, 0
          ) AS mano,
          COALESCE(
            (SELECT SUM((i->>'cantidad')::numeric * (i->>'precio')::numeric)
             FROM jsonb_array_elements(COALESCE(prefactura_items,'[]'::jsonb)) i), 0
          ) AS rep
        FROM citas
        WHERE (prefactura_items IS NOT NULL AND prefactura_items <> '[]'::jsonb)
           OR prefactura_mano_obra IS NOT NULL
           OR (prefactura_servicios IS NOT NULL AND prefactura_servicios <> '[]'::jsonb)
      )`;

    // Períodos: mano de obra y repuestos por cada ventana de tiempo
    const { rows } = await pool.query(`
      WITH ${PF_BASE}
      SELECT
        SUM(mano) FILTER (WHERE fecha = (now() AT TIME ZONE 'America/Guayaquil')::date)                       AS hoy_mano,
        SUM(rep)  FILTER (WHERE fecha = (now() AT TIME ZONE 'America/Guayaquil')::date)                       AS hoy_rep,
        COUNT(*)  FILTER (WHERE fecha = (now() AT TIME ZONE 'America/Guayaquil')::date)                       AS hoy_ord,
        SUM(mano) FILTER (WHERE fecha >= date_trunc('week', (now() AT TIME ZONE 'America/Guayaquil')::date))  AS semana_mano,
        SUM(rep)  FILTER (WHERE fecha >= date_trunc('week', (now() AT TIME ZONE 'America/Guayaquil')::date))  AS semana_rep,
        COUNT(*)  FILTER (WHERE fecha >= date_trunc('week', (now() AT TIME ZONE 'America/Guayaquil')::date))  AS semana_ord,
        SUM(mano) FILTER (WHERE fecha >= date_trunc('month', (now() AT TIME ZONE 'America/Guayaquil')::date)) AS mes_mano,
        SUM(rep)  FILTER (WHERE fecha >= date_trunc('month', (now() AT TIME ZONE 'America/Guayaquil')::date)) AS mes_rep,
        COUNT(*)  FILTER (WHERE fecha >= date_trunc('month', (now() AT TIME ZONE 'America/Guayaquil')::date)) AS mes_ord,
        SUM(mano) FILTER (WHERE fecha >= date_trunc('month', (now() AT TIME ZONE 'America/Guayaquil')::date) - INTERVAL '1 month'
                            AND fecha < date_trunc('month', (now() AT TIME ZONE 'America/Guayaquil')::date))  AS mesant_mano,
        SUM(rep)  FILTER (WHERE fecha >= date_trunc('month', (now() AT TIME ZONE 'America/Guayaquil')::date) - INTERVAL '1 month'
                            AND fecha < date_trunc('month', (now() AT TIME ZONE 'America/Guayaquil')::date))  AS mesant_rep,
        COUNT(*)  FILTER (WHERE fecha >= date_trunc('month', (now() AT TIME ZONE 'America/Guayaquil')::date) - INTERVAL '1 month'
                            AND fecha < date_trunc('month', (now() AT TIME ZONE 'America/Guayaquil')::date))  AS mesant_ord,
        SUM(mano) FILTER (WHERE fecha >= date_trunc('year', (now() AT TIME ZONE 'America/Guayaquil')::date))  AS anio_mano,
        SUM(rep)  FILTER (WHERE fecha >= date_trunc('year', (now() AT TIME ZONE 'America/Guayaquil')::date))  AS anio_rep,
        COUNT(*)  FILTER (WHERE fecha >= date_trunc('year', (now() AT TIME ZONE 'America/Guayaquil')::date))  AS anio_ord,
        SUM(mano)                                                           AS total_mano,
        SUM(rep)                                                            AS total_rep,
        COUNT(*)                                                            AS total_ord,
        AVG(mano + rep) FILTER (WHERE (mano + rep) > 0)                     AS ticket_promedio
      FROM pf
    `);

    // Meses del año en curso, desde este mes hasta diciembre (empieza en cero y se llena)
    const { rows: meses } = await pool.query(`
      WITH ${PF_BASE},
      serie AS (
        SELECT generate_series(
          date_trunc('month', (now() AT TIME ZONE 'America/Guayaquil')::date),
          date_trunc('year', (now() AT TIME ZONE 'America/Guayaquil')::date) + INTERVAL '1 year' - INTERVAL '1 month',
          INTERVAL '1 month'
        ) AS mes_inicio
      )
      SELECT
        TO_CHAR(s.mes_inicio, 'YYYY-MM')          AS mes,
        TO_CHAR(s.mes_inicio, 'Mon YY')           AS mes_label,
        COUNT(pf.fecha)                           AS ordenes,
        COALESCE(SUM(pf.mano), 0)                 AS mano,
        COALESCE(SUM(pf.rep), 0)                  AS repuestos
      FROM serie s
      LEFT JOIN pf ON date_trunc('month', pf.fecha) = s.mes_inicio
      GROUP BY s.mes_inicio
      ORDER BY s.mes_inicio
    `);

    // Marcas más frecuentes (actividad, sin cambios)
    const { rows: marcas } = await pool.query(`
      SELECT cl.marca, COUNT(*) AS n
      FROM citas c JOIN clientes cl ON cl.telefono = c.telefono
      WHERE cl.marca IS NOT NULL AND cl.marca != ''
      GROUP BY cl.marca ORDER BY n DESC LIMIT 8
    `);

    // Técnico más activo (actividad, sin cambios)
    const { rows: tecTop } = await pool.query(`
      SELECT tecnico, COUNT(*) AS n
      FROM citas WHERE tecnico IS NOT NULL
      GROUP BY tecnico ORDER BY n DESC LIMIT 5
    `);

    const p = rows[0];
    const f = (v) => parseFloat(v) || 0;
    const per = (mano, rep, ord) => ({ mano: f(mano), repuestos: f(rep), ordenes: parseInt(ord) || 0 });

    res.json({
      periodos: {
        hoy:         per(p.hoy_mano,    p.hoy_rep,    p.hoy_ord),
        semana:      per(p.semana_mano, p.semana_rep, p.semana_ord),
        mes:         per(p.mes_mano,    p.mes_rep,    p.mes_ord),
        mesAnterior: per(p.mesant_mano, p.mesant_rep, p.mesant_ord),
        anio:        per(p.anio_mano,   p.anio_rep,   p.anio_ord),
        total:       per(p.total_mano,  p.total_rep,  p.total_ord),
      },
      ticketPromedio: f(p.ticket_promedio),
      meses: meses.map(m => ({
        mes: m.mes, label: m.mes_label,
        ordenes: parseInt(m.ordenes) || 0,
        mano: f(m.mano), repuestos: f(m.repuestos),
      })),
      marcas: marcas.map(m => ({ marca: m.marca, n: parseInt(m.n) })),
      tecnicos: tecTop.map(t => ({ tecnico: t.tecnico, n: parseInt(t.n) })),
    });
  } catch (e) { dbError(res, e); }
});

// ── Estadísticas por categoría ────────────────────────────────────────────────
router.get('/stats/categorias', async (req, res) => {
  try {
    // Ingresos por orden: usa la PREFACTURA (factura real) si existe; si no, el
    // estimado de la orden de trabajo (repuestos_detalle + mano_de_obra).
    const { rows } = await pool.query(`
      WITH base AS (
        SELECT
          CASE
            WHEN tipo_servicio IS NULL OR btrim(tipo_servicio) = ''            THEN 'Sin categoría'
            WHEN tipo_servicio IN ('Mantenimiento','Mantenimiento Preventivo') THEN 'Mantenimiento'
            WHEN tipo_servicio IN ('Cambio de aceite','Cambio de Aceite')      THEN 'Cambio de aceite'
            WHEN tipo_servicio IN ('Colisión','Colisión y Carrocería','Pintura','Enderezada y Pintura') THEN 'Colisión'
            WHEN tipo_servicio IN ('Detailing','Lavada','Pulida','Lavada y Detailing','Pulida y Encerado') THEN 'Detailing'
            WHEN tipo_servicio IN ('Motor','Motor — Diagnóstico y Reparación') THEN 'Motor'
            WHEN tipo_servicio IN ('Transmisión','Transmisión y Caja')         THEN 'Transmisión'
            WHEN tipo_servicio IN ('Revisión Técnica Vehicular (RTV)','RTV')   THEN 'Revisión Técnica Vehicular (RTV)'
            WHEN tipo_servicio = 'Robo / Seguro'                               THEN 'Robo / Seguro'
            WHEN tipo_servicio = 'Cotizaciones'                                THEN 'Cotizaciones'
            WHEN tipo_servicio = 'Servicios Varios'                            THEN 'Servicios Varios'
            ELSE 'Servicios Varios'   -- catch-all: Taladros, 4x4 / Off-road, Frenos, etc.
          END AS categoria,
          estado_orden, fecha,
          ((prefactura_items IS NOT NULL AND prefactura_items <> '[]'::jsonb)
            OR prefactura_mano_obra IS NOT NULL) AS tiene_prefactura,
          COALESCE((SELECT SUM((i->>'cantidad')::numeric * (i->>'precio')::numeric)
                    FROM jsonb_array_elements(COALESCE(prefactura_items,'[]'::jsonb)) i
                    WHERE i->>'concepto' IS NOT NULL), 0) AS pf_rep,
          COALESCE(prefactura_mano_obra, 0) AS pf_mano,
          COALESCE((SELECT SUM((i->>'cantidad')::numeric * (i->>'precio')::numeric)
                    FROM jsonb_array_elements(COALESCE(repuestos_detalle,'[]'::jsonb)) i
                    WHERE i->>'concepto' IS NOT NULL), 0) AS ot_rep,
          COALESCE(mano_de_obra, 0) AS ot_mano
        FROM citas
      ), calc AS (
        SELECT categoria, estado_orden, fecha,
          CASE WHEN tiene_prefactura THEN pf_rep  ELSE ot_rep  END AS rep,
          CASE WHEN tiene_prefactura THEN pf_mano ELSE ot_mano END AS mano
        FROM base
      )
      SELECT categoria,
        COUNT(*)                                                  AS total,
        COUNT(*) FILTER (WHERE estado_orden = 'Completada')       AS completadas,
        COUNT(*) FILTER (WHERE estado_orden IN ('Pendiente','Borrador','En proceso','Aprobada')) AS activas,
        COALESCE(SUM(rep), 0)                                     AS ingresos_repuestos,
        COALESCE(SUM(mano), 0)                                    AS ingresos_mano_obra,
        COALESCE(AVG(rep + mano) FILTER (WHERE rep + mano > 0), 0) AS ticket_promedio,
        COUNT(*) FILTER (WHERE fecha >= (now() AT TIME ZONE 'America/Guayaquil')::date - INTERVAL '30 days') AS ultimo_mes,
        COUNT(*) FILTER (WHERE fecha >= (now() AT TIME ZONE 'America/Guayaquil')::date - INTERVAL '60 days'
                          AND fecha <  (now() AT TIME ZONE 'America/Guayaquil')::date - INTERVAL '30 days') AS mes_anterior,
        MIN(fecha)::text AS primera_orden,
        MAX(fecha)::text AS ultima_orden
      FROM calc
      GROUP BY categoria
      ORDER BY total DESC
    `);

    const result = rows.map(r => {
      const ingresosManoObra  = parseFloat(r.ingresos_mano_obra) || 0;
      const ingresosRepuestos = parseFloat(r.ingresos_repuestos) || 0;
      return {
        categoria:          r.categoria,
        total:              parseInt(r.total),
        completadas:        parseInt(r.completadas),
        activas:            parseInt(r.activas),
        ingresosManoObra,
        ingresosRepuestos,
        ingresosTotal:      ingresosManoObra + ingresosRepuestos,
        ticketPromedio:     parseFloat(r.ticket_promedio) || 0,
        ultimoMes:          parseInt(r.ultimo_mes),
        mesAnterior:        parseInt(r.mes_anterior),
        primeraOrden:       r.primera_orden,
        ultimaOrden:        r.ultima_orden,
      };
    });

    res.json(result);
  } catch (e) { dbError(res, e); }
});

// ── Reincidencias ─────────────────────────────────────────────────────────────

router.get('/reincidencias', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM reincidencias ORDER BY created_at DESC LIMIT 100`
    );
    res.json(rows);
  } catch (e) { dbError(res, e); }
});

// Registrar reincidencia manualmente (botón en Órdenes cuando un auto vuelve)
router.post('/reincidencias', async (req, res) => {
  try {
    const b = req.body;
    const mismaFalla = b.mismaFalla === true || b.mismaFalla === 'true';

    // Dedupe: la orden de regreso puede tener ya una reincidencia (la auto-creada por
    // createWorkOrder). En vez de duplicar, se actualiza con los datos manuales del owner.
    if (b.citaRegresoId) {
      const { rows: dup } = await pool.query(
        'SELECT id FROM reincidencias WHERE cita_regreso_id = $1 LIMIT 1', [b.citaRegresoId]
      );
      if (dup.length) {
        await pool.query(
          `UPDATE reincidencias SET
             motivo_regreso   = COALESCE($1, motivo_regreso),
             misma_falla      = $2,
             tecnico          = COALESCE($3, tecnico),
             trabajo_original = COALESCE($4, trabajo_original),
             fecha_original   = COALESCE($5, fecha_original),
             cita_original_id = COALESCE($6, cita_original_id)
           WHERE id = $7`,
          [b.motivoRegreso || null, mismaFalla, b.tecnico || null, b.trabajoOriginal || null,
           b.fechaOriginal || null, b.citaOriginalId || null, dup[0].id]
        );
        return res.json({ ok: true, id: dup[0].id, deduped: true });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO reincidencias
         (placa, telefono, cliente_nombre, tecnico, trabajo_original,
          fecha_original, fecha_regreso, motivo_regreso, misma_falla,
          cita_original_id, cita_regreso_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [b.placa || null, b.telefono || null, b.clienteNombre || null, b.tecnico || null,
       b.trabajoOriginal || null, b.fechaOriginal || null, b.fechaRegreso || null,
       b.motivoRegreso || null, mismaFalla,
       b.citaOriginalId || null, b.citaRegresoId || null]
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (e) { dbError(res, e); }
});

router.patch('/reincidencias/:id', async (req, res) => {
  try {
    const { motivo_regreso, misma_falla, estado } = req.body;
    await pool.query(
      `UPDATE reincidencias SET
         motivo_regreso = COALESCE($1, motivo_regreso),
         misma_falla    = COALESCE($2, misma_falla),
         estado         = COALESCE($3, estado)
       WHERE id = $4`,
      [motivo_regreso ?? null, misma_falla ?? null, estado ?? null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { dbError(res, e); }
});

// ── Técnicos ──────────────────────────────────────────────────────────────────

router.get('/tecnicos', (req, res) => {
  const tecnicos = (process.env.SHOP_TECHNICIANS || '').split(',').map(t => t.trim()).filter(Boolean);
  res.json(tecnicos);
});

// ── Catálogo de precios (servicios y materiales) ───────────────────────────────

router.get('/catalogo', async (req, res) => {
  try {
    const tipo = req.query.tipo || null;
    const { rows } = await pool.query(
      `SELECT id, nombre, tipo, precio::float AS precio, activo
         FROM catalogo
        WHERE activo = true ${tipo ? 'AND tipo = $1' : ''}
        ORDER BY tipo, nombre`,
      tipo ? [tipo] : []
    );
    res.json(rows);
  } catch (e) { dbError(res, e); }
});

router.post('/catalogo', async (req, res) => {
  try {
    const { nombre, tipo, precio } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Nombre requerido' });
    const t = (tipo === 'servicio') ? 'servicio' : 'material';
    const { rows } = await pool.query(
      `INSERT INTO catalogo (nombre, tipo, precio) VALUES ($1, $2, $3)
       RETURNING id, nombre, tipo, precio::float AS precio, activo`,
      [nombre.trim(), t, parseFloat(precio) || 0]
    );
    res.json(rows[0]);
  } catch (e) { dbError(res, e); }
});

router.patch('/catalogo/:id', async (req, res) => {
  try {
    const allowed = ['nombre', 'tipo', 'precio', 'activo'];
    const sets = [], vals = [];
    let i = 1;
    for (const [k, v] of Object.entries(req.body)) {
      if (allowed.includes(k)) { sets.push(`${k} = $${i}`); vals.push(v); i++; }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
    vals.push(req.params.id);
    await pool.query(`UPDATE catalogo SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    res.json({ ok: true });
  } catch (e) { dbError(res, e); }
});

router.delete('/catalogo/:id', async (req, res) => {
  try {
    // Borrado lógico para no afectar órdenes históricas
    await pool.query('UPDATE catalogo SET activo = false WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { dbError(res, e); }
});

// Cerrar sesión: invalida el token y limpia la cookie del panel.
router.post('/logout', (req, res) => {
  const token = req.headers['x-session-token'] || (req.cookies && req.cookies.tgm_sid);
  if (token) sessions.delete(token);
  res.clearCookie('tgm_sid');
  res.json({ ok: true });
});

// Valida un token de sesión (lo usa server.js para proteger GET /admin).
router.isValidSession = function (token) {
  const s = token && sessions.get(token);
  if (!s) return false;
  if (Date.now() > s.expiresAt) { sessions.delete(token); return false; }
  return true;
};

module.exports = router;
