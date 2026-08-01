# Cómo crear un cliente nuevo (guía sencilla, sin tecnicismos)

Esta guía es para ti, la persona. No necesitas saber programar. Tu trabajo es **copiar la
carpeta, poner la info del cliente, y dejar que un chat de Claude haga la parte técnica.**

> **Respuesta corta a tu duda:** Sí. Duplicas la carpeta de TG Motors, le cambias el nombre,
> le metes la info del cliente nuevo, abres un chat de Claude dentro de esa carpeta y le pides
> que lo ponga en marcha. Claude sigue la guía técnica ([REPLICAR-NUEVO-CLIENTE.md](REPLICAR-NUEVO-CLIENTE.md))
> por ti. Tú solo copias y pegas lo que te pida.

Piensa en la carpeta de TG Motors como un **molde**. Cada cliente nuevo es una **copia del molde**
con su propia info. No se mezclan entre ellos.

---

## Lo que haces TÚ (con el mouse, 10 minutos)

### Paso 1 — Duplicar la carpeta
1. Abre **Finder**.
2. Busca la carpeta **`Workflow TG Motors`**.
3. Click derecho → **Duplicar** (o Cmd+C y Cmd+V).
4. Renombra la copia con el nombre del cliente, por ejemplo **`Taller Los Andes`**.

Ya tienes el molde copiado. Nada de lo que hagas aquí afecta a TG Motors.

### Paso 2 — Juntar la info del cliente
Llena esta hojita con los datos del cliente (más abajo hay una versión para copiar y pegar):

- Nombre del taller
- Ciudad y dirección
- Horarios de atención
- Qué servicios ofrece
- Nombres de los técnicos
- Cuántos autos atiende a la vez
- Nombre y teléfono del dueño
- Logo del taller (archivo de imagen)
- Lista de precios en Excel (servicios y repuestos)

> Si el cliente no tiene lista de precios ordenada, no pasa nada: se puede arrancar con unos
> pocos precios y completar después.

### Paso 3 — Crear la base de datos (lo único un poco técnico, pero son clicks)
El sistema necesita una "base de datos" donde guardar los clientes, órdenes, etc. Se crea en una
página web llamada **Railway**:

1. Entra a **railway.app** e inicia sesión (o crea la cuenta).
2. Botón **New Project** → elige **Provision PostgreSQL**.
3. Cuando se cree, entra a esa base, busca donde dice **Connect** y copia el texto largo que
   empieza con `postgresql://...`. **Ese texto es la llave de la base.** Guárdalo, se lo darás a Claude.

Eso es todo lo que haces tú. Lo demás lo hace Claude.

---

## Lo que hace CLAUDE (tú solo respondes lo que te pregunte)

### Paso 4 — Abrir un chat de Claude dentro de la carpeta nueva
1. En el mismo programa donde me hablas ahora, **abre la carpeta nueva** (`Taller Los Andes`).
2. Empieza un **chat nuevo** ahí.
3. **Copia y pega este mensaje** (es el "botón de arranque"):

```
Hola. Esta carpeta es una copia del sistema de taller de TG Motors para un cliente NUEVO.
Quiero ponerlo en marcha SOLO el core (sin WhatsApp por ahora).

Sigue la guía REPLICAR-NUEVO-CLIENTE.md paso a paso. Hazlo tú y ve pidiéndome
una cosa a la vez, en lenguaje simple, lo que necesites de mí (la llave de la base
de datos, la API key, la info del taller y el Excel de precios).

Cuando termines, dame el link del panel y el usuario y contraseña para entrar.
No corras setup-production.js. Avísame antes de desplegar.
```

### Paso 5 — Responder lo que Claude te pida
Claude te irá preguntando, y tú solo pegas:
- La **llave de la base de datos** (el `postgresql://...` del Paso 3).
- La **API key de Anthropic** (puedes reusar la misma tuya; si no tienes, Claude te dice cómo sacarla).
- La **info del taller** (la hojita del Paso 2).
- El **Excel de precios** y el **logo** (los pones dentro de la carpeta y le dices a Claude dónde).

Claude se encarga de: preparar la base, cambiar el nombre "TG Motors" por el del cliente nuevo,
cargar los precios, y subirlo a internet.

### Paso 6 — Comprobar que quedó listo
Al final Claude te da:
- Un **link** (la dirección web del panel del cliente).
- Un **usuario y contraseña** para entrar.

Abres el link, entras, creas una orden de prueba. Si funciona, **ya está listo para mostrárselo
al cliente y venderlo.** WhatsApp se conecta después, cuando el cliente lo contrate.

---

## Formulario para copiar y pegar (info del cliente)

Llénalo y pégaselo a Claude cuando te lo pida:

```
Nombre del taller:
Ciudad:
Dirección:
Horarios:
Servicios que ofrece:
Nombres de los técnicos:
Autos que atiende a la vez:
Nombre del dueño:
Teléfono del dueño (con código de país, solo números):
Usuario para el panel (un correo):
Contraseña para el panel:
```

---

## Resumen en una frase

**Copiar carpeta → renombrar → meter info del cliente → crear la base en Railway → abrir un chat
de Claude en la carpeta y pegarle el mensaje de arranque.** Claude hace el resto y te entrega el
link. Eso es replicar un cliente.

---

## Preguntas que te vas a hacer

**¿Cada cliente necesita su propia carpeta?** Sí. Una copia por cliente. No se comparten.

**¿Puedo usar la misma cuenta de Railway y la misma API key para todos?** Sí, puedes. Solo que
cada cliente tendrá su propia base de datos dentro de tu cuenta.

**¿Y WhatsApp?** Es un extra. El sistema funciona y se vende sin WhatsApp. Cuando el cliente lo
quiera, abres un chat de Claude en esa carpeta y le pides que active el add-on de WhatsApp (está
explicado en la guía técnica, sección 10).

**¿Necesito entender lo técnico?** No. Para eso está Claude. Tú das la info y apruebas; él ejecuta.
```
