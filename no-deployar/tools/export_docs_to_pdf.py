"""
Genera PDF desde los HTML de manuales y presentaciones (contenido equivalente a los .md).
Usa un servidor HTTP local para que las rutas relativas a imágenes resuelvan bien, y
fuerza la carga de todas las imágenes (los HTML usan loading="lazy", que deja en blanco
lo que queda fuera del primer viewport al imprimir a PDF).

Requiere: py -m pip install playwright && py -m playwright install chromium
"""
from __future__ import annotations

import contextlib
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parent.parent

EXPORTS: list[tuple[Path, Path]] = [
    (ROOT / "User Manual" / "MANUAL_DE_USUARIO.html", ROOT / "User Manual" / "MANUAL_DE_USUARIO.pdf"),
    (ROOT / "User Manual" / "USER_MANUAL.html", ROOT / "User Manual" / "USER_MANUAL.pdf"),
    (ROOT / "User Manual" / "MANUEL_UTILISATEUR.html", ROOT / "User Manual" / "MANUEL_UTILISATEUR.pdf"),
    (ROOT / "Presentation" / "PRESENTACION_GNEEX.html", ROOT / "Presentation" / "PRESENTACION_GNEEX.pdf"),
    (ROOT / "Presentation" / "PRESENTATION_GNEEX.html", ROOT / "Presentation" / "PRESENTATION_GNEEX.pdf"),
    (ROOT / "Presentation" / "PRESENTATION_GNEEX_FR.html", ROOT / "Presentation" / "PRESENTATION_GNEEX_FR.pdf"),
]


@contextlib.contextmanager
def serve_project_root() -> int:
    """Sirve ROOT en 127.0.0.1:puerto y devuelve el puerto."""
    root = str(ROOT.resolve())

    class _Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=root, **kwargs)

        def log_message(self, _format, *_args) -> None:
            pass  # silencio

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    port = int(httpd.server_address[1])
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield port
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def _url_for_path(port: int, file_path: Path) -> str:
    rel = file_path.resolve().relative_to(ROOT.resolve())
    return f"http://127.0.0.1:{port}/{quote(rel.as_posix(), safe='/')}"


def _load_all_images(page: Page) -> None:
    """Quita lazy-load, desplaza todo el documento (las imágenes lazy solo cargan al entrar al viewport) y espera decodificación."""
    page.emulate_media(media="screen")
    page.evaluate(
        """() => {
      for (const img of document.querySelectorAll("img")) {
        img.removeAttribute("loading");
      }
    }"""
    )
    # Recorrer el alto de la página para que loading=lazy pida cada recurso
    page.evaluate(
        """async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      const step = Math.max(200, Math.floor(window.innerHeight * 0.75));
      for (let y = 0; y <= h; y += step) {
        window.scrollTo(0, y);
        await sleep(80);
      }
      window.scrollTo(0, 0);
      await sleep(150);
    }"""
    )
    page.wait_for_function(
        "() => Array.from(document.images).every((i) => i.complete)",
        timeout=120_000,
    )
    # Fuentes web y decodificación
    page.wait_for_timeout(500)


def main() -> None:
    missing = [src for src, _ in EXPORTS if not src.is_file()]
    if missing:
        raise SystemExit(f"Faltan archivos: {missing}")

    margin = {"top": "12mm", "right": "12mm", "bottom": "12mm", "left": "12mm"}
    with serve_project_root() as port:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.set_viewport_size({"width": 1280, "height": 900})
            for src, dst in EXPORTS:
                url = _url_for_path(port, src)
                page.goto(url, wait_until="load", timeout=120_000)
                _load_all_images(page)
                try:
                    page.pdf(
                        path=str(dst),
                        format="A4",
                        print_background=True,
                        margin=margin,
                        display_header_footer=False,
                    )
                except PermissionError:
                    raise SystemExit(
                        f"No se pudo escribir {dst.name}: ciérralo en el visor de PDFs "
                        f"y pausa la sincronización de OneDrive en esa carpeta si bloquea el archivo, "
                        f"luego vuelve a ejecutar: py tools/export_docs_to_pdf.py"
                    ) from None
                print(f"OK {dst.name}")
            browser.close()


if __name__ == "__main__":
    main()
