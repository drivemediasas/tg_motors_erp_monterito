/**
 * Cargador de PROVEEDORES.
 *
 * Cuando el dueño del taller mande la lista de números de sus proveedores,
 * se pegan aquí en PROVEEDORES y se sube el SEED_VERSION (ej. v1, v2...).
 * En el próximo deploy, `ensureSchema` corre este seed UNA vez por versión
 * (registrado en la tabla `_migraciones`), marcando cada número como proveedor.
 *
 * También se puede correr manual dentro de Railway:  node tools/db/seed-proveedores.js
 * (Localmente NO conecta: la BD usa host interno de Railway.)
 */
const { setProvidersBulk } = require('./mark-provider');

// ── Pegar aquí la lista del dueño (teléfono en formato 593XXXXXXXXX o 09XXXXXXXX) ──
// Ej: { telefono: '593999123456', nombre: 'Distribuidora Guaipes' }
// Lista v1 (2026-09-12) — fuente: Proveedores_TG_MOTORS.csv (89 contactos).
// Formato canónico 593XXXXXXXXX (así llega el número desde WhatsApp).
const PROVEEDORES = [
  { telefono: '593987868018', nombre: "Andrés CORPOROIL" },
  { telefono: '593997257450', nombre: "Andrés Carmona Full Mannol" },
  { telefono: '593984400220', nombre: "David Cortez" },
  { telefono: '593986202901', nombre: "Fullenergy Crédito Y Cobranzas Daysi Contadora Energy" },
  { telefono: '593995022612', nombre: "Mansuera Quito" },
  { telefono: '593984091511', nombre: "Norma Mites Proveedor Cobranzas" },
  { telefono: '593960498555', nombre: "Sebástian MANSUERA" },
  { telefono: '593984007627', nombre: "SEBASTIÁN Mansuera" },
  { telefono: '593992204906', nombre: "Andrés Calle Repuestos Mazda" },
  { telefono: '593983920961', nombre: "Andrés Salas Repuestos MG" },
  { telefono: '593962660214', nombre: "Asia Repuestos Condado" },
  { telefono: '593987038728', nombre: "Auto Japón Repuestos Honda Toyota" },
  { telefono: '593984498717', nombre: "Auto Sky Repuestos Hyundai Kia Daewoo Chevrolet Mitsubishi" },
  { telefono: '593999474785', nombre: "Automeca Repuestos BMW" },
  { telefono: '593991691783', nombre: "Automotriz Villacís Repuestos Mitsubishi" },
  { telefono: '593985594758', nombre: "Autorepuestos Japón Alexis Cuenca" },
  { telefono: '593984361407', nombre: "Autorepuestos Quito Ford Repuestos Ford" },
  { telefono: '593963146601', nombre: "Autosky Repuestos" },
  { telefono: '593987226756', nombre: "Avisan Quito Repuestos" },
  { telefono: '593982343777', nombre: "Repuestos BMW" },
  { telefono: '593984459002', nombre: "Bimmer Parts Repuestos BMW" },
  { telefono: '593981664669', nombre: "Bmw Locura Repuestos BMW" },
  { telefono: '593994896622', nombre: "Bosch Repuestos" },
  { telefono: '593984603393', nombre: "BrasilMotors Prensa Repuestos" },
  { telefono: '593969041256', nombre: "BrasilMotors Prensa Repuestos" },
  { telefono: '593987252079', nombre: "Repuestos Casanova" },
  { telefono: '593984663026', nombre: "China Auto Parts Repuestos Chinos" },
  { telefono: '593980830062', nombre: "China Motors Repuestos Chinos" },
  { telefono: '593995076016', nombre: "Cruzan Cía Ltda Repuestos Toyota" },
  { telefono: '593997713337', nombre: "Daniel Bermello Repuestos Tipán" },
  { telefono: '593984044437', nombre: "Dario Pinto Repuestos Citroen" },
  { telefono: '593963517865', nombre: "David Acosta Repuestos Mitsubishi Sólo Whatsap Repuestos Mitsubishi" },
  { telefono: '593997694243', nombre: "David Automotores Y Anexos Repuestos TG" },
  { telefono: '593990525148', nombre: "DB Repuestos FIAT" },
  { telefono: '593993913670', nombre: "Disauto Repuestos Nissan" },
  { telefono: '593987933535', nombre: "Distribuidora Oña Repuestos Automotrices Repuestos Y Frenos Ford" },
  { telefono: '593998132322', nombre: "Ecuawagen Repuestos Andrés Delgado" },
  { telefono: '593987288092', nombre: "Edison Chimbo Repuestos Japoneses Y Coreanos" },
  { telefono: '593998369124', nombre: "El Carro Frances Repuestos" },
  { telefono: '593959291904', nombre: "EL ORIGINAL \"MAZDA-FORD\" Repuestos Repuestos" },
  { telefono: '593992037697', nombre: "Emerson Repuestos Ford" },
  { telefono: '593987595672', nombre: "Estrada Repuestos Renatho Bombas Inyección Sistema Eléctrico Y Encendido" },
  { telefono: '593987891975', nombre: "Fiat HMV Repuestos Fiat" },
  { telefono: '593995582275', nombre: "Ford Repuestos Ramiro Viracucha" },
  { telefono: '593987835169', nombre: "Gales Repuestos Renault" },
  { telefono: '593998757472', nombre: "GT Autorepuestos Sucursal La Prensa Repuestos Audi Volkswagen Skoda" },
  { telefono: '593987319437', nombre: "Guaranda Figueroa Condado Repuestos" },
  { telefono: '593998129090', nombre: "Harold Ford Fomoco Ford Repuestos Fomoco" },
  { telefono: '593984737033', nombre: "Honda Automotriz Repuestos" },
  { telefono: '593984898358', nombre: "Honda Repuestos Honda Repuestos" },
  { telefono: '593996039705', nombre: "Honda Sport Repuestos" },
  { telefono: '593992949825', nombre: "Import China Repuestos Chinos Don Miguel" },
  { telefono: '593992834443', nombre: "Importadora Arguello Repuestos Ford" },
  { telefono: '593992037655', nombre: "Importadora Sánchez Repuestos Ford" },
  { telefono: '593998127206', nombre: "Imporval Repuestos Kia Hyundai Chevrolet Daewood" },
  { telefono: '593983500518', nombre: "Jonathan Toapanta Repuestos Chevrolet Automotores Continental" },
  { telefono: '593999669868', nombre: "K&P Repuestos TG" },
  { telefono: '593991428193', nombre: "Kendry VVSupplyGarage Repuestos Toyota Repuestos Toyota" },
  { telefono: '593995882830', nombre: "La Casa Del Mitsubishi Repuestos" },
  { telefono: '593997647477', nombre: "Lacsa Citroen Repuestos" },
  { telefono: '593986246724', nombre: "Lina Repuestos Chinos" },
  { telefono: '593961905500', nombre: "Mitsuba Repuestos Mitsubishi" },
  { telefono: '593999502526', nombre: "MKM Repuestos Ford Chevrolet Jeep Dodge" },
  { telefono: '593992536432', nombre: "Montalvo Honda Repuestos" },
  { telefono: '593998307217', nombre: "Nissan Renault Repuestos" },
  { telefono: '593999618318', nombre: "Oscar Cortez Hyundai Casa Repuestos" },
  { telefono: '593984489101', nombre: "Paul Repuestos Citroen" },
  { telefono: '593999667627', nombre: "Propartes Repuestos Kia, Hyundai, Daewoo" },
  { telefono: '593991991079', nombre: "Q5 REPUESTOS TALLER PUNTO AUDI" },
  { telefono: '593992509950', nombre: "Recordmotor Repuestos Franklin López" },
  { telefono: '593987068531', nombre: "Regensa Repuestos Mitsubishi" },
  { telefono: '593997675642', nombre: "Renamotor Repuestos Renault" },
  { telefono: '593998033835', nombre: "Renamotors Repuestos Renault" },
  { telefono: '593999728431', nombre: "Repuestos Amcar Suzuki Samurai" },
  { telefono: '593984569711', nombre: "Repuestos Caiza El Condado Volkswagen, Renault" },
  { telefono: '593994024571', nombre: "Repuestos FR Repuestos Ford" },
  { telefono: '593998530790', nombre: "Repuestos Korean Mobis" },
  { telefono: '593983830258', nombre: "REPUESTOS MITSUBISHI" },
  { telefono: '593984687802', nombre: "REPUESTOS MITSUBISHI JL" },
  { telefono: '593992977018', nombre: "REPUESTOS RV Fiat Renault BMW Chevrolet Audi Volvo" },
  { telefono: '593999197500', nombre: "Rodarepuestos Rodamientos" },
  { telefono: '593999041574', nombre: "Rodrigo Repuestos Arguello" },
  { telefono: '593990426819', nombre: "Ruben Llive Repuestos UIO Mitsubishi Casa" },
  { telefono: '593984510692', nombre: "Sap Auto Parts tu casa Nissan Repuestos Nissan" },
  { telefono: '593999905276', nombre: "Sr Escobar Repuestos Mercedes Benz Bmw" },
  { telefono: '593963778544', nombre: "Steven Barrionuevo Repuestos Toyota Casabaca" },
  { telefono: '593968463143', nombre: "Zheng Lin Auto Repuestos Chinos" },
  { telefono: '593986169056', nombre: "Dayana Jaramillo / Llanticentro" },
  { telefono: '593993441183', nombre: "Iveth Wartsila" },
];

// Subir esta versión cada vez que se cambie la lista (dispara el re-seed en deploy).
const SEED_VERSION = 'v1';

async function seedProveedores() {
  if (!PROVEEDORES.length) {
    console.log('[seed-proveedores] lista vacía — nada que cargar (SEED_VERSION=' + SEED_VERSION + ')');
    return 0;
  }
  const n = await setProvidersBulk(PROVEEDORES);
  console.log(`[seed-proveedores] ${n} proveedor(es) marcados (SEED_VERSION=${SEED_VERSION})`);
  return n;
}

module.exports = { PROVEEDORES, SEED_VERSION, seedProveedores };

// Permite correrlo directo (dentro de Railway): node tools/db/seed-proveedores.js
if (require.main === module) {
  seedProveedores().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
}
