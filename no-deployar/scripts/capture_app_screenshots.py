"""
Capturas PNG de G-NEEX para manuales y presentaciones (v1.7).

Uso:
  py -m pip install playwright
  py -m playwright install chromium
  py no-deployar/scripts/capture_app_screenshots.py

Variables de entorno opcionales:
  GNEEX_CAPTURE_USER / GNEEX_CAPTURE_PASS  →  credenciales (admin integrado por defecto)
  GNEEX_CAPTURE_HEADLESS  →  "0" para ver el navegador en vivo (debug)
  GNEEX_CAPTURE_SKIP_SPLASH  →  "1" para no esperar al welcome splash (no recomendado)

Salida:
  no-deployar/docs/app-screenshots/capture-{lang}-*.png

Cambios v1.7:
  - Espera al welcome splash (9 s, cinemático) antes de tirar la primera captura del panel.
  - Cubre las pantallas nuevas: menú de herramientas con "Actualizar inventario",
    editor de artículo con sección de lotes, modal de caducidad con cantidad afectada.
  - Limpia `gneex-welcome-splash-shown` en cada idioma para que el splash entre
    siempre en la primera carga (pero saltamos su captura — es transitorio y no
    aporta a los manuales).
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Instale: py -m pip install playwright", file=sys.stderr)
    sys.exit(1)

# Repo root (este archivo vive en no-deployar/scripts/)
ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / "index.html"
OUT = ROOT / "no-deployar" / "docs" / "app-screenshots"

DEFAULT_USER = os.environ.get("GNEEX_CAPTURE_USER", "goireteluis")
DEFAULT_PASS = os.environ.get("GNEEX_CAPTURE_PASS", "negrolik3")
HEADLESS = os.environ.get("GNEEX_CAPTURE_HEADLESS", "1") != "0"
SKIP_SPLASH_WAIT = os.environ.get("GNEEX_CAPTURE_SKIP_SPLASH", "0") == "1"

LANGS = ("es", "en", "fr")

# Pestañas principales (orden coherente con manuales).
TAB_SHOTS: list[tuple[str, str]] = [
    ("panel", 'button[data-tab="dashboard"]'),
    ("inventario", 'button[data-tab="inventory"]'),
    ("movimientos", 'button[data-tab="movements"]'),
    ("historial", 'button[data-tab="history"]'),
    ("transporte", 'button[data-tab="transport"]'),
    ("pedidos", 'button[data-tab="orderlines"]'),
    ("recordatorios", 'button[data-tab="reminders"]'),
]


def file_url(path: Path) -> str:
    return path.resolve().as_uri()


def slug(name: str) -> str:
    return re.sub(r"[^\w\-.]+", "-", name).strip("-")


def set_login_lang(page, code: str) -> None:
    el = page.locator("#login-language-select")
    if el.count():
        el.select_option(value=code)
        page.wait_for_timeout(300)


def set_app_lang(page, code: str) -> None:
    page.evaluate(
        """(code) => {
        const s = document.getElementById('language-select');
        if (s) { s.value = code; s.dispatchEvent(new Event('change', { bubbles: true })); }
    }""",
        code,
    )
    page.wait_for_timeout(400)


def wait_for_app_ready(page) -> None:
    """Espera a que el login gate desaparezca, la cabecera sea visible y el
    welcome splash (9 s cinemático) termine. Si por algún motivo el splash
    no aparece (sessionStorage ya marcado), igual seguimos."""
    page.wait_for_function(
        "() => document.getElementById('login-gate')?.classList.contains('login-gate--hidden')",
        timeout=60000,
    )
    page.wait_for_selector("header.main-header", state="visible", timeout=30000)
    if SKIP_SPLASH_WAIT:
        page.wait_for_timeout(500)
        return
    # El splash entra con `hidden=false`. Espera a que termine la animación o se oculte.
    # Ahora dura 9 s (cinemático), así que damos 11 s de margen.
    try:
        page.wait_for_function(
            """() => {
                const n = document.getElementById('welcome-splash');
                return !n || n.hasAttribute('hidden') || n.getAttribute('aria-hidden') === 'true';
            }""",
            timeout=11000,
        )
    except Exception:
        # No es bloqueante: seguimos aunque el splash no salga (en F5 puede no salir).
        pass
    page.wait_for_timeout(400)


def reset_session_flags(page) -> None:
    """Limpia banderas de sesión para forzar comportamiento de primera entrada."""
    page.evaluate(
        """() => {
            try { sessionStorage.removeItem('gneex-welcome-splash-shown'); } catch {}
            try { sessionStorage.removeItem('phoenix-file-protocol-storage-toast'); } catch {}
        }"""
    )


def capture_inventory_extras(page, lang: str) -> None:
    """Capturas adicionales en Inventario (v1.7): menú de herramientas y editor
    de artículo con sección de lotes si hay al menos un artículo."""
    try:
        page.locator('button[data-tab="inventory"]').first.click()
        page.wait_for_timeout(600)
    except Exception:
        return

    # Menú de herramientas (botón ⋮): muestra "Actualizar inventario" y plantillas solo-stock.
    try:
        btn = page.locator("#inventory-header-tools-menu-btn, [data-inv-tools-menu-btn]")
        if btn.count():
            btn.first.click(timeout=5000)
            page.wait_for_timeout(400)
            page.screenshot(path=str(OUT / f"capture-{lang}-inventario-herramientas.png"))
            # Cerrar el menú clicando fuera.
            page.mouse.click(10, 10)
            page.wait_for_timeout(200)
    except Exception:
        pass

    # Editor de artículo (primer artículo de la tabla) — sección de lotes v1.7.
    try:
        first_row_btn = page.locator(
            "#inventory-table tbody tr button[data-action='edit-item'], "
            "#inventory-table tbody tr .btn-edit-item"
        ).first
        if first_row_btn.count():
            first_row_btn.click(timeout=5000)
            page.wait_for_selector("#item-edit-modal", state="visible", timeout=8000)
            page.wait_for_timeout(500)
            page.screenshot(path=str(OUT / f"capture-{lang}-articulo-editor.png"))
            # Cerrar modal.
            close = page.locator("#item-edit-modal .modal-close").first
            if close.count():
                close.click(timeout=3000)
                page.wait_for_timeout(300)
    except Exception:
        pass


def main() -> int:
    if not INDEX.is_file():
        print(f"No se encuentra {INDEX}", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=HEADLESS)
        for lang in LANGS:
            context = browser.new_context(
                viewport={"width": 1440, "height": 900},
                device_scale_factor=1,
            )
            page = context.new_page()
            page.goto(file_url(INDEX), wait_until="load", timeout=120000)
            page.wait_for_timeout(500)
            reset_session_flags(page)
            set_login_lang(page, lang)
            page.wait_for_timeout(300)
            page.screenshot(path=str(OUT / f"capture-{lang}-01-login.png"))

            page.locator("#login-username").fill(DEFAULT_USER)
            page.locator("#login-password").fill(DEFAULT_PASS)
            page.locator("#login-form-standard button[type=submit], .btn-login").first.click()
            wait_for_app_ready(page)
            set_app_lang(page, lang)
            page.wait_for_timeout(500)

            for key, sel in TAB_SHOTS:
                try:
                    page.locator(sel).first.click(timeout=10000)
                except Exception:
                    continue
                page.wait_for_timeout(700)
                page.screenshot(path=str(OUT / f"capture-{lang}-{slug(key)}.png"))

            # Configuración → Usuarios.
            try:
                page.locator("#config-btn").click()
                page.wait_for_timeout(500)
                page.locator('[data-config-tab="users"], button[data-config-tab="users"]').first.click(
                    timeout=10000
                )
                page.wait_for_timeout(600)
                page.screenshot(path=str(OUT / f"capture-{lang}-config-usuarios.png"))
                # Cerrar modal de configuración.
                close = page.locator("#config-modal .modal-close").first
                if close.count():
                    close.click(timeout=3000)
                    page.wait_for_timeout(300)
            except Exception:
                pass

            # Extras v1.7.
            capture_inventory_extras(page, lang)

            context.close()
        browser.close()

    print("OK", OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
