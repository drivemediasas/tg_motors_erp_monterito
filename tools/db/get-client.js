const pool = require('./client');

async function getClient(telefono) {
  // Match flexible por número: WhatsApp manda 593XXXXXXXXX pero el registro puede
  // estar como 0987..., +593..., 987.... Comparamos por los últimos 9 dígitos
  // (el número de celular ecuatoriano), prefiriendo la coincidencia exacta.
  const { rows } = await pool.query(
    `SELECT * FROM clientes
      WHERE regexp_replace(telefono,'\\D','','g') = regexp_replace($1,'\\D','','g')
         OR RIGHT(regexp_replace(telefono,'\\D','','g'), 9) = RIGHT(regexp_replace($1,'\\D','','g'), 9)
      ORDER BY (regexp_replace(telefono,'\\D','','g') = regexp_replace($1,'\\D','','g')) DESC
      LIMIT 1`,
    [telefono]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    nombre: r.nombre,
    telefono: r.telefono,
    email: r.email,
    cedula: r.cedula,
    direccion: r.direccion,
    es_proveedor: r.es_proveedor === true,
    placa: r.placa,
    marca: r.marca,
    modelo: r.modelo,
    anio: r.anio,
    año: r.anio,
    fechaUltimoServicio: r.fecha_ultimo_servicio,
    notas: r.notas,
  };
}

module.exports = { getClient };
