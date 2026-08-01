#!/usr/bin/env python3
"""
Genera el Manual de Usuario de TG Motors con capturas de pantalla anotadas.

Requisitos:
  pip install Pillow reportlab

Uso:
  python3 scripts/generar-manual.py

El servidor debe estar corriendo en http://localhost:3000
Genera: documentos/Manual-TG-Motors.pdf
"""

import os
import sys
import time
import subprocess
import shutil
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Error: pip install Pillow")

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm, cm
    from reportlab.lib.colors import HexColor, white, black
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Image as RLImage,
        PageBreak, Table, TableStyle, HRFlowable
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
except ImportError:
    sys.exit("Error: pip install reportlab")

# ── Rutas ───────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
TMP  = ROOT / ".tmp" / "manual_screenshots"
OUT  = ROOT / "documentos" / "Manual-TG-Motors.pdf"
LOGO = ROOT / "public" / "img" / "logo-horizontal.svg"

BASE_URL  = "http://localhost:3000"
ADMIN_URL = f"{BASE_URL}/admin"

# ── Secciones a capturar ─────────────────────────────────────────────────────
# Cada sección: (id_archivo, título, url_hash, descripción, anotaciones)
# anotaciones: lista de (x%, y%, texto, tipo) donde tipo es 'arrow'|'box'|'num'
SECCIONES = [
    ("01-login",    "Inicio de Sesión",       "",              "Pantalla de ingreso al sistema.",
     [(50, 55, "Ingresa tu correo y contraseña", "box"), (50, 73, "Haz clic aquí para entrar", "arrow")]),

    ("02-dashboard","Panel de Actividades",   "#actividades",  "Resumen del día: órdenes, agenda y KPIs.",
     [(25, 20, "KPIs del día", "num1"), (25, 45, "Agenda de hoy", "num2"), (25, 70, "Órdenes pendientes", "num3")]),

    ("03-nueva-orden-p1","Nueva Orden – Paso 1: Cliente","#nueva-orden","Busca un cliente existente o crea uno nuevo.",
     [(50, 35, "Busca por nombre, teléfono o placa", "box"), (50, 60, "O crea un cliente nuevo", "arrow")]),

    ("04-nueva-orden-p2","Nueva Orden – Paso 2: Servicio","#nueva-orden","Selecciona el tipo de servicio.",
     [(50, 50, "Elige el tipo de servicio del vehículo", "box")]),

    ("05-nueva-orden-blueprint","Nueva Orden – Paso 5: Daños","#nueva-orden","Marca los puntos de daño en el plano del vehículo.",
     [(50, 45, "Haz clic sobre el vehículo para marcar daños", "arrow")]),

    ("06-nueva-orden-trabajos","Nueva Orden – Paso 6: Trabajos","#nueva-orden","Agrega los trabajos y repuestos con sus precios.",
     [(50, 35, "Escribe para buscar en el catálogo", "box"), (50, 62, "Agrega repuestos de la misma forma", "arrow")]),

    ("07-nueva-orden-tecnico","Nueva Orden – Paso 7: Técnico","#nueva-orden","Asigna el técnico y guarda la orden.",
     [(50, 40, "Selecciona el técnico responsable", "box"), (50, 70, "Guarda la orden de trabajo", "arrow")]),

    ("08-ordenes",  "Listado de Órdenes",     "#ordenes",      "Filtra y gestiona todas las órdenes del taller.",
     [(50, 25, "Filtra por estado, fecha o tipo", "box"), (80, 55, "Acciones: ver, editar, PDF, WhatsApp", "arrow")]),

    ("09-enviar-wa","Enviar Orden por WhatsApp","#ordenes",    "Envía la prefactura directamente al cliente.",
     [(50, 55, "Clic en el ícono de WhatsApp", "arrow")]),

    ("10-calendario","Calendario de Citas",   "#calendario",   "Visualiza y agrega citas del taller.",
     [(50, 40, "Navega por el mes", "box"), (80, 30, "Crea una nueva cita rápida", "arrow")]),

    ("11-clientes", "Gestión de Clientes",    "#clientes",     "Busca clientes y revisa su historial de servicios.",
     [(50, 25, "Busca por nombre, placa o teléfono", "box"), (50, 60, "Historial completo del cliente", "arrow")]),

    ("12-finanzas", "Finanzas",               "#finanzas",     "KPIs de ingresos por período y técnico.",
     [(25, 25, "Ingresos del día / semana / mes", "num1"), (25, 55, "Tendencia de 12 meses", "num2")]),

    ("13-catalogo", "Catálogo de Servicios",  "#catalogo",     "Administra precios de servicios y materiales.",
     [(50, 30, "Lista de servicios y materiales con precios", "box"), (50, 75, "Agrega nuevos ítems aquí", "arrow")]),
]

# ── Colores marca ─────────────────────────────────────────────────────────────
GREEN   = HexColor("#1b5e20")
GREEN_L = HexColor("#e8f5e9")
GRAY    = HexColor("#6b7280")
RED_ANN = (220, 30, 30)   # anotaciones PIL


def ensure_tmp():
    TMP.mkdir(parents=True, exist_ok=True)


def take_screenshot(url: str, filename: str) -> Path:
    """Toma captura con screencapture de macOS vía AppleScript."""
    out = TMP / filename
    script = f'''
tell application "Google Chrome"
    activate
    set URL of active tab of front window to "{url}"
    delay 2.5
end tell
delay 0.5
do shell script "screencapture -x {out}"
'''
    # Intentar con Chrome; si falla, Safari
    try:
        subprocess.run(["osascript", "-e", script], check=True, capture_output=True)
    except subprocess.CalledProcessError:
        script_safari = f'''
tell application "Safari"
    activate
    set URL of document 1 to "{url}"
    delay 2.5
end tell
delay 0.5
do shell script "screencapture -x {out}"
'''
        subprocess.run(["osascript", "-e", script_safari], check=True, capture_output=True)
    return out


def annotate(img_path: Path, annotations: list) -> Path:
    """Dibuja flechas y cuadros de anotación sobre la captura."""
    img = Image.open(img_path).convert("RGBA")
    W, H = img.size

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 22)
        font_sm = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
    except Exception:
        font = ImageFont.load_default()
        font_sm = font

    num_idx = 1
    for (xp, yp, texto, tipo) in annotations:
        x = int(W * xp / 100)
        y = int(H * yp / 100)

        if tipo == "arrow":
            # Flecha apuntando al punto
            ax, ay = x, y
            tx, ty = x - 120, y - 60
            draw.line([(tx + 60, ty + 30), (ax, ay)], fill=(*RED_ANN, 230), width=4)
            draw.polygon([(ax, ay), (ax - 14, ay - 20), (ax + 14, ay - 20)], fill=(*RED_ANN, 230))
            # Burbuja de texto
            padding = 8
            bbox = draw.textbbox((0, 0), texto, font=font_sm)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            rx0, ry0 = tx - padding, ty - padding
            rx1, ry1 = tx + tw + padding * 2, ty + th + padding * 2
            draw.rounded_rectangle([rx0, ry0, rx1, ry1], radius=6,
                                    fill=(*RED_ANN, 220), outline=(255, 255, 255, 255), width=2)
            draw.text((tx + padding, ty + padding), texto, font=font_sm, fill=(255, 255, 255, 255))

        elif tipo == "box":
            # Recuadro rojo resaltando zona
            half_w, half_h = 220, 35
            draw.rounded_rectangle([x - half_w, y - half_h, x + half_w, y + half_h],
                                    radius=8, outline=(*RED_ANN, 200), width=4)
            # Etiqueta encima
            label_y = y - half_h - 36
            bbox = draw.textbbox((0, 0), texto, font=font_sm)
            tw = bbox[2] - bbox[0]
            lx = x - tw // 2
            draw.rounded_rectangle([lx - 8, label_y - 4, lx + tw + 8, label_y + 26],
                                    radius=5, fill=(*RED_ANN, 220))
            draw.text((lx, label_y), texto, font=font_sm, fill=(255, 255, 255, 255))

        elif tipo.startswith("num"):
            num = num_idx
            num_idx += 1
            r = 22
            draw.ellipse([x - r, y - r, x + r, y + r], fill=(*RED_ANN, 230),
                          outline=(255, 255, 255, 220), width=3)
            num_str = str(num)
            bbox = draw.textbbox((0, 0), num_str, font=font)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            draw.text((x - tw // 2, y - th // 2), num_str, font=font, fill=(255, 255, 255, 255))
            # Texto al lado
            draw.text((x + r + 8, y - 12), texto, font=font_sm, fill=(*RED_ANN, 230))

    composite = Image.alpha_composite(img, overlay).convert("RGB")
    out = img_path.parent / f"ann_{img_path.name}"
    composite.save(out, "PNG")
    return out


# ── ReportLab helpers ─────────────────────────────────────────────────────────

def build_styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle("TGTitle",
        fontSize=28, textColor=GREEN, fontName="Helvetica-Bold",
        alignment=TA_CENTER, spaceAfter=6))
    styles.add(ParagraphStyle("TGSubtitle",
        fontSize=13, textColor=GRAY, fontName="Helvetica",
        alignment=TA_CENTER, spaceAfter=4))
    styles.add(ParagraphStyle("SecTitle",
        fontSize=16, textColor=GREEN, fontName="Helvetica-Bold",
        spaceBefore=10, spaceAfter=6))
    styles.add(ParagraphStyle("SecDesc",
        fontSize=11, textColor=HexColor("#333333"), fontName="Helvetica",
        spaceBefore=0, spaceAfter=8))
    styles.add(ParagraphStyle("Footer",
        fontSize=8, textColor=GRAY, fontName="Helvetica",
        alignment=TA_CENTER))
    return styles


def cover_page(styles):
    elements = []
    elements.append(Spacer(1, 60))

    # Logo horizontal (SVG no soportado directamente; usar PNG si existe, sino texto)
    logo_png = ROOT / "public" / "img" / "logo-horizontal.png"
    if logo_png.exists():
        elements.append(RLImage(str(logo_png), width=200, height=50))
        elements.append(Spacer(1, 20))

    elements.append(Paragraph("MANUAL DE USUARIO", styles["TGTitle"]))
    elements.append(Spacer(1, 10))
    elements.append(Paragraph("Sistema de Gestión TG Motors", styles["TGSubtitle"]))
    elements.append(Spacer(1, 6))
    elements.append(Paragraph("Panel Administrativo — Guía paso a paso", styles["TGSubtitle"]))
    elements.append(Spacer(1, 40))
    elements.append(HRFlowable(width="80%", thickness=2, color=GREEN, spaceAfter=20))
    elements.append(Spacer(1, 20))
    elements.append(Paragraph("Taller Automotriz TG Motors", styles["TGSubtitle"]))
    elements.append(Paragraph("Quito, Ecuador", styles["TGSubtitle"]))
    elements.append(Spacer(1, 10))
    from datetime import date
    elements.append(Paragraph(f"Junio {date.today().year}", styles["TGSubtitle"]))
    elements.append(PageBreak())
    return elements


def index_page(styles):
    elements = []
    elements.append(Paragraph("Contenido", styles["SecTitle"]))
    elements.append(Spacer(1, 8))
    for i, (_, titulo, _, desc, _) in enumerate(SECCIONES, 1):
        elements.append(Paragraph(f"{i}. {titulo}", styles["SecDesc"]))
    elements.append(PageBreak())
    return elements


def section_page(sec_id, titulo, desc, ann_path: Path | None, styles, page_w, page_h):
    elements = []
    elements.append(Paragraph(titulo, styles["SecTitle"]))
    elements.append(Paragraph(desc, styles["SecDesc"]))

    if ann_path and ann_path.exists():
        max_w = page_w - 4 * cm
        max_h = page_h * 0.65
        try:
            with Image.open(ann_path) as im:
                iw, ih = im.size
            ratio = min(max_w / iw, max_h / ih)
            elements.append(RLImage(str(ann_path), width=iw * ratio, height=ih * ratio))
        except Exception as e:
            elements.append(Paragraph(f"[Captura no disponible: {e}]", styles["SecDesc"]))
    else:
        elements.append(Paragraph(
            "ⓘ Para generar esta captura, asegúrate de que el servidor esté corriendo "
            "en http://localhost:3000 antes de ejecutar el script.",
            styles["SecDesc"]))

    elements.append(PageBreak())
    return elements


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ensure_tmp()
    OUT.parent.mkdir(parents=True, exist_ok=True)

    screenshots_taken = {}
    server_running = False

    # Verificar si el servidor está corriendo
    import urllib.request
    try:
        urllib.request.urlopen(f"{BASE_URL}/health", timeout=3)
        server_running = True
        print(f"✓ Servidor detectado en {BASE_URL}")
    except Exception:
        print(f"⚠  Servidor no encontrado en {BASE_URL}")
        print("   El manual se generará sin capturas de pantalla reales.")
        print("   Para incluir capturas: corre 'npm start' y vuelve a ejecutar este script.")

    if server_running:
        print("\nAbriendo navegador y tomando capturas...")
        for (sec_id, titulo, url_hash, _, annotations) in SECCIONES:
            url = ADMIN_URL + url_hash
            fname = f"{sec_id}.png"
            print(f"  [{sec_id}] {titulo}...")
            try:
                raw = take_screenshot(url, fname)
                ann = annotate(raw, annotations)
                screenshots_taken[sec_id] = ann
                print(f"         ✓ Captura anotada guardada.")
            except Exception as e:
                print(f"         ✗ Error: {e}")

    # Construir PDF
    print("\nGenerando PDF...")
    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=A4,
        rightMargin=2*cm, leftMargin=2*cm,
        topMargin=2*cm, bottomMargin=2*cm,
        title="Manual de Usuario — TG Motors",
        author="TG Motors",
    )
    page_w, page_h = A4
    styles = build_styles()

    story = []
    story += cover_page(styles)
    story += index_page(styles)

    for (sec_id, titulo, _, desc, _) in SECCIONES:
        ann_path = screenshots_taken.get(sec_id)
        story += section_page(sec_id, titulo, desc, ann_path, styles, page_w, page_h)

    doc.build(story)
    print(f"\n✓ Manual generado: {OUT}")
    print(f"  Páginas: portada + índice + {len(SECCIONES)} secciones")

    if not server_running:
        print("\n  NOTA: El manual contiene el esquema de secciones pero sin capturas.")
        print("  Levanta el servidor (npm start) y vuelve a ejecutar para el PDF final.")


if __name__ == "__main__":
    main()
