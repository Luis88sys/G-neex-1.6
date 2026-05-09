"""
Capturas PNG de G-NEEX para manuales y presentaciones.
  py -m pip install playwright
  py -m playwright install chromium
  py scripts/capture_app_screenshots.py

GNEEX_CAPTURE_USER / GNEEX_CAPTURE_PASS (opcional; por defecto admin integrado, ver js/auth.js).
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

LANGS = ("es", "en", "fr")

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


def main() -> int:
    if not INDEX.is_file():
        print(f"No se encuentra {INDEX}", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for lang in LANGS:
            context = browser.new_context(
                viewport={"width": 1440, "height": 900},
                device_scale_factor=1,
            )
            page = context.new_page()
            page.goto(file_url(INDEX), wait_until="load", timeout=120000)
            page.wait_for_timeout(500)
            set_login_lang(page, lang)
            page.wait_for_timeout(300)
            page.screenshot(path=str(OUT / f"capture-{lang}-01-login.png"))

            page.locator("#login-username").fill(DEFAULT_USER)
            page.locator("#login-password").fill(DEFAULT_PASS)
            page.locator("#login-form-standard button[type=submit], .btn-login").first.click()
            page.wait_for_function(
                "() => document.getElementById('login-gate')?.classList.contains('login-gate--hidden')",
                timeout=60000,
            )
            page.wait_for_selector("header.main-header", state="visible", timeout=30000)
            page.wait_for_timeout(500)
            set_app_lang(page, lang)
            page.wait_for_timeout(500)

            for key, sel in TAB_SHOTS:
                try:
                    page.locator(sel).first.click(timeout=10000)
                except Exception:
                    continue
                page.wait_for_timeout(700)
                page.screenshot(path=str(OUT / f"capture-{lang}-{slug(key)}.png"))

            # Configuración → Usuarios
            try:
                page.locator("#config-btn").click()
                page.wait_for_timeout(500)
                page.locator('[data-config-tab="users"], button[data-config-tab="users"]').first.click(
                    timeout=10000
                )
                page.wait_for_timeout(600)
                page.screenshot(path=str(OUT / f"capture-{lang}-config-usuarios.png"))
            except Exception:
                pass

            context.close()
        browser.close()

    print("OK", OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
