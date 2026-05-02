# -*- coding: utf-8 -*-
"""Lectura común de la rejilla Phoenix HISTORY (merges, INITIAL QUANTITY, stock)."""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from typing import Any

# Cantidad pegada a ____ o saldo: admite coma o punto decimal (Phoenix FR / Excel).
_PHX_DEC = r"-?(?:\d+(?:[,.]\d+)?)"
_BALANCE_AFTER = re.compile(rf"____\s*({_PHX_DEC})")
_QTY_BEFORE_MARK = re.compile(rf"(?<![/\d])({_PHX_DEC})\s*____")
_QTY_BEFORE_LENIENT = re.compile(rf"({_PHX_DEC})\s*____")
_DELTA_START = re.compile(rf"^({_PHX_DEC})")
_ISO = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
_PROJECT = re.compile(r"PROJECT:\s*(.+)$", re.IGNORECASE)


def parse_european_float(token: str) -> float:
    """
    Interpreta un trozo numérico de celda Phoenix: coma o punto como decimal,
    o ambos (miles US vs decimal EU).
    """
    t = (
        token.strip()
        .replace(" ", "")
        .replace("\u2212", "-")
        .replace("\u2013", "-")
    )
    if not t or t == "-":
        raise ValueError("empty numeric token")
    neg = t.startswith("-")
    body = t[1:] if neg else t
    if "," in body and "." in body:
        if body.rfind(".") > body.rfind(","):
            body = body.replace(",", "")
        else:
            body = body.replace(".", "").replace(",", ".")
    elif "," in body:
        body = body.replace(",", ".")
    r = float(body if not neg else "-" + body)
    if not math.isfinite(r):
        raise ValueError("non-finite")
    return r


def maybe_repair_concatenated_decimal(raw_token: str, parsed: float) -> float:
    """
    Si la coma decimal desapareció al exportar (p. ej. 50833333333333 en vez de 50,833333…),
    reinterpretar como decimal con parte entera corta.
    """
    t = raw_token.strip().replace("\u2212", "-").replace("\u2013", "-")
    neg = t.startswith("-")
    core = t[1:] if neg else t
    core = core.replace(" ", "")
    if "," in core or "." in core:
        return parsed
    if not core.isdigit():
        return parsed
    abs_p = abs(parsed)
    ln = len(core)
    # ej. 50833333333333 → 50.83333333333333
    if ln >= 11 and abs_p >= 10**10:
        repaired = float(core[:2] + "." + core[2:])
        return -repaired if neg else repaired
    # ej. 53950333 → 53.950333…
    if ln >= 8 and abs_p >= 5.0 * 10**7:
        repaired = float(core[:2] + "." + core[2:])
        return -repaired if neg else repaired
    # No aplicar /1000 sobre todo 4 dígitos: corrompería cantidades reales (p. ej. 5434 tornillos).
    # Celdas tipo 6125 → 6,125 deben venir con coma en Excel o corregirse a mano en datos ya migrados.
    return parsed


def quantity_token_to_float(raw_token: str) -> float:
    """Parseo + reparación heurística para enteros concatenados."""
    base = parse_european_float(raw_token)
    return maybe_repair_concatenated_decimal(raw_token, base)


def _fmt_delta_label(x: float) -> str:
    if math.isfinite(x) and abs(x - round(x)) < 1e-9:
        return str(int(round(x)))
    s = f"{x:.12f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-") else str(x)


def anchor_cell(ws, row: int, col: int):
    """Celda openpyxl de la esquina superior izquierda del rango combinado que contiene (row, col)."""
    for m in ws.merged_cells.ranges:
        if m.min_row <= row <= m.max_row and m.min_col <= col <= m.max_col:
            return ws.cell(m.min_row, m.min_col)
    return ws.cell(row, col)


def effective_cell_value(ws, row: int, col: int):
    """Valor mostrado; si la celda está en un merge, usa la esquina superior izquierda."""
    return anchor_cell(ws, row, col).value


def find_last_initial_quantity_column(ws, header_row: int) -> int | None:
    """
    Columna **INITIAL QUANTITY** de inventario: la **más a la izquierda** (menor índice
    de columna), que en Phoenix es la **más reciente** en el tiempo: al leer la rejilla
    **de derecha a izquierda** (de lo viejo a lo nuevo), lo actual queda a la **izquierda**.

    Algoritmo: recorrer columnas **1 … max_column** y devolver la **primera** subcabecera
    ``INITIAL_QUANTITY`` (equivale al mínimo ``c`` entre todas las que lo son).

    El nombre ``find_last_*`` y el flag ``--last-initial-col`` se mantienen por compatibilidad;
    el criterio semántico es **instantánea reciente = columna izquierda**.
    """
    for c in range(1, ws.max_column + 1):
        hdr = effective_cell_value(ws, header_row, c)
        if not isinstance(hdr, str):
            continue
        nk = hdr.strip().upper().replace(" ", "_")
        if nk == "INITIAL_QUANTITY":
            return c
    return None


def stock_from_initial_quantity_cell(cell_value, fallback: float) -> float:
    """
    Stock en una celda de bloque INITIAL QUANTITY: número, texto numérico o saldo con ____.
    """
    v = cell_value
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    if isinstance(v, str):
        s = (
            v.replace("\r", "")
            .strip()
            .replace("\u2212", "-")
            .replace("\u2013", "-")
        )
        if "____" in s:
            m = _QTY_BEFORE_MARK.search(s) or _BALANCE_AFTER.search(s)
            if m:
                try:
                    return quantity_token_to_float(m.group(1))
                except (ValueError, ArithmeticError):
                    pass
        s2 = s.replace(" ", "").replace(",", ".")
        try:
            return float(s2)
        except ValueError:
            pass
    return fallback


def safe_float_cell(v: Any) -> float:
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def is_initial_quantity_header(ws, header_row: int, col: int) -> bool:
    h = effective_cell_value(ws, header_row, col)
    return (
        isinstance(h, str)
        and h.strip().upper().replace(" ", "_") == "INITIAL_QUANTITY"
    )


def parse_movement_cell_detail(
    text: str, col_date: str | None
) -> tuple[float, str, str, str, str] | None:
    """
    Como parse_movement_cell, más `modo_parseo`:
    - qty_before____ — número pegado al marcador (preferido)
    - balance_after____ — saldo sólo después de ____
    - line_start_legacy — primer entero al inicio de la celda (ambiguo; p. ej. -5/16)
    - qty_before_____repaired — se tomó otro N____ en la celda (último candidato válido)
    """
    raw = (
        text.replace("\r", "")
        .strip()
        .replace("\u2212", "-")
        .replace("\u2013", "-")
    )
    if "____" not in raw:
        return None
    modo = "qty_before____"
    m0 = _QTY_BEFORE_MARK.search(raw)
    if not m0:
        m0 = _BALANCE_AFTER.search(raw)
        modo = "balance_after____"
    if not m0:
        m0 = _DELTA_START.match(raw)
        modo = "line_start_legacy"
    if not m0:
        return None
    try:
        qty = quantity_token_to_float(m0.group(1))
    except (ValueError, ArithmeticError):
        return None
    # Reparación automática: si sólo quedó el entero inicial, buscar otro N____ en la celda
    # (evita leer -5 de "-5/16 …" cuando más a la derecha está el movimiento real).
    if modo == "line_start_legacy":
        for m in reversed(list(_QTY_BEFORE_LENIENT.finditer(raw))):
            i = m.start(1)
            if i > 0 and raw[i - 1] == "/":
                continue
            try:
                cand = quantity_token_to_float(m.group(1))
            except (ValueError, ArithmeticError):
                continue
            if m.start() == m0.start() and math.isclose(cand, qty, rel_tol=0, abs_tol=1e-12):
                continue
            qty = cand
            modo = "qty_before_____repaired"
            break
    im = _ISO.search(raw)
    date_s = im.group(1) if im else (col_date or "1970-01-01")
    pm = _PROJECT.search(raw)
    project = (pm.group(1) or "").strip() if pm else ""
    project = re.sub(r"\s+", " ", project).strip()
    return qty, date_s, project, raw, modo


def parse_movement_cell(text: str, col_date: str | None) -> tuple[float, str, str, str] | None:
    """Cantidad (delta), fecha YYYY-MM-DD, projectId, raw. Misma lógica que el export JSON."""
    d = parse_movement_cell_detail(text, col_date)
    if not d:
        return None
    return d[0], d[1], d[2], d[3]


def _preview_cell(s: str, max_len: int = 140) -> str:
    one = re.sub(r"\s+", " ", s.replace("\r", " ").replace("\n", " ")).strip()
    return one[:max_len] + ("…" if len(one) > max_len else "")


def compute_stock_along_grid(
    ws,
    row: int,
    header_row: int,
    first_move_col: int,
    last_iq_col: int,
    initial_col: int,
    col_dt: dict[int, str | None],
) -> tuple[float, float, list[dict]]:
    """
    Para una **fila de artículo**, recorre columnas de movimiento y snapshots INITIAL
    QUANTITY intermedios; el **objetivo** de inventario es la celda en ``last_iq_col``
    (subcabecera INITIAL QUANTITY **más a la izquierda** = instantánea más reciente).

    Rango recorrido:
    - Si ``last_iq_col > first_move_col`` (bloque clásico: movimientos antes del INITIAL
      final a la derecha): columnas ``[first_move_col, last_iq_col)``.
    - Si ``last_iq_col < first_move_col`` (INITIAL reciente a la izquierda, movimientos
      hacia la derecha): columnas ``[first_move_col, max_column]``.

    No se trata ``last_iq_col`` como columna de delta: solo define el valor objetivo
    y el límite en el caso clásico.

    Usa ``effective_cell_value`` (merge) en INITIAL y movimientos.
    Devuelve (calculado, objetivo, lista de operaciones leídas con modo_parseo y trozo).
    """
    ini = safe_float_cell(effective_cell_value(ws, row, initial_col))
    running = ini
    target = stock_from_initial_quantity_cell(
        effective_cell_value(ws, row, last_iq_col), ini
    )
    movements: list[dict] = []

    if last_iq_col > first_move_col:
        end_exclusive = last_iq_col
    else:
        end_exclusive = ws.max_column + 1

    if first_move_col >= end_exclusive:
        return running, target, movements

    for c in range(first_move_col, end_exclusive):
        if is_initial_quantity_header(ws, header_row, c):
            running = stock_from_initial_quantity_cell(
                effective_cell_value(ws, row, c), running
            )
            continue
        v = effective_cell_value(ws, row, c)
        if isinstance(v, str) and "____" in v:
            d = parse_movement_cell_detail(v, col_dt.get(c))
            if d:
                delta = float(d[0])
                modo = d[4]
                running += delta
                movements.append(
                    {
                        "col": c,
                        "delta": delta,
                        "modo_parseo": modo,
                        "trozo_celda": _preview_cell(v),
                        "mal_leida_sospecha": modo
                        in ("line_start_legacy", "_____sin_lectura"),
                    }
                )
            else:
                movements.append(
                    {
                        "col": c,
                        "delta": None,
                        "modo_parseo": "_____sin_lectura",
                        "trozo_celda": _preview_cell(v),
                        "mal_leida_sospecha": True,
                    }
                )
    return running, target, movements


def run_reconciliation_audit(
    ws,
    header_row: int,
    first_data_row: int,
    last_iq_col: int,
    first_move_col: int,
    initial_col: int,
    code_col: int,
    col_dt: dict[int, str | None],
    abs_tol: float = 0.5,
) -> tuple[list[dict], Counter[int], int, int, list[dict], list[dict]]:
    """
    Devuelve:
    - `operaciones_sospechosas`: lecturas **ambigüas o fallidas** (legacy o ____ sin número).
    - `operaciones_descuadre_todas`: **todas** las celdas con ____ leídas en filas descuadradas
      (para ver modos qty_before____ vs balance_after____ vs line_start_legacy).
    """
    mismatches: list[dict] = []
    col_hits: Counter[int] = Counter()
    total = 0
    ok_count = 0
    operaciones_sospechosas: list[dict] = []
    operaciones_descuadre_todas: list[dict] = []

    for r in range(first_data_row, ws.max_row + 1):
        raw_code = effective_cell_value(ws, r, code_col)
        if raw_code is None or str(raw_code).strip() == "":
            continue
        code = str(raw_code).strip()
        if code.upper() == "CODE":
            continue
        total += 1
        comp, tgt, movs = compute_stock_along_grid(
            ws,
            r,
            header_row,
            first_move_col,
            last_iq_col,
            initial_col,
            col_dt,
        )
        if math.isclose(comp, tgt, rel_tol=0, abs_tol=abs_tol):
            ok_count += 1
            continue
        diff = comp - tgt
        parts_delta = []
        detalle_parts = []
        alertas: list[str] = []
        for m in movs:
            c = m["col"]
            d = m["delta"]
            modo = m["modo_parseo"]
            if d is not None:
                lab = _fmt_delta_label(float(d))
                parts_delta.append(f"{c}:{lab}")
                detalle_parts.append(f"{c}={lab}[{modo}]")
            else:
                detalle_parts.append(f"{c}[{modo}]")
            col_hits[c] += 1
            operaciones_descuadre_todas.append(
                {
                    "fila": r,
                    "codigo": code,
                    "col_movimiento": c,
                    "delta": d if d is not None else "",
                    "modo_parseo": modo,
                    "trozo_celda": m.get("trozo_celda", ""),
                    "diff_inventario_fila": diff,
                }
            )
            if m.get("mal_leida_sospecha"):
                motivo = (
                    "primer_entero_linea_ambiguo"
                    if modo == "line_start_legacy"
                    else "_____sin_numero_parseable"
                )
                alertas.append(f"col{c}:{motivo}")
                operaciones_sospechosas.append(
                    {
                        "fila": r,
                        "codigo": code,
                        "col_movimiento": c,
                        "delta": d if d is not None else "",
                        "modo_parseo": modo,
                        "trozo_celda": m.get("trozo_celda", ""),
                        "motivo": motivo,
                    }
                )
        mov_str = ";".join(parts_delta)
        mismatches.append(
            {
                "fila": r,
                "codigo": code,
                "initial_col": safe_float_cell(
                    effective_cell_value(ws, r, initial_col)
                ),
                "calculado": comp,
                "inventario": tgt,
                "diff": diff,
                "movimientos_col_delta": mov_str,
                "detalle_modos_parseo": " | ".join(detalle_parts),
                "alertas_lectura": "; ".join(alertas) if alertas else "",
            }
        )

    return (
        mismatches,
        col_hits,
        total,
        ok_count,
        operaciones_sospechosas,
        operaciones_descuadre_todas,
    )


def diagnostico_texto_filas_problematicas(
    mismatches: list[dict],
    mal_leidas: list[dict],
    ops_descuadre_todas: list[dict],
) -> str:
    """
    Informe legible (ES) por cada fila descuadrada: qué se leyó, dónde puede estar el error.
    """
    ops_by: dict[tuple[int, str], list[dict]] = defaultdict(list)
    for o in ops_descuadre_todas:
        ops_by[(int(o["fila"]), str(o["codigo"]))].append(o)
    mal_by: dict[tuple[int, str], list[dict]] = defaultdict(list)
    for m in mal_leidas:
        mal_by[(int(m["fila"]), str(m["codigo"]))].append(m)

    lines: list[str] = []
    lines.append("=== DIAGNÓSTICO — Filas de artículo donde calculado ≠ inventario ===\n")
    lines.append(
        "En cada bloque: operaciones leídas (columna = movimiento/fecha), modo de parseo, "
        "y trozo de celda. ⚠ = lectura ambigua (primer entero al inicio) o ____ sin número.\n"
    )

    for row in mismatches:
        key = (int(row["fila"]), str(row["codigo"]))
        r, code = key
        lines.append("=" * 76)
        lines.append(f"Fila Excel {r}  |  Código: {code}")
        lines.append(
            f"  Arranque (--initial-col): {row['initial_col']!s}  →  "
            f"Inventario ref. (INITIAL QUANTITY más a la izquierda / más reciente): {row['inventario']!s}"
        )
        lines.append(
            f"  Suma simulada (INITIAL + movimientos + snapshots IQ): {row['calculado']!s}"
        )
        lines.append(f"  Diferencia (calculado − inventario): {row['diff']!s}")
        try:
            calc_n = float(row["calculado"])
            inv_n = float(row["inventario"])
            if abs(calc_n) > max(5000.0, abs(inv_n) * 5.0):
                lines.append(
                    "  ℹ Si la suma simulada es claramente absurda frente al inventario de la hoja, "
                    "suele deberse a cantidades mal leídas en columnas intermedias (p. ej. primer entero en "
                    "código 3/8, UNC) o a cómo Excel resolvió celdas combinadas; el stock de referencia sigue "
                    "siendo la INITIAL QUANTITY de inventario (más a la izquierda)."
                )
        except (TypeError, ValueError):
            pass
        if row.get("detalle_modos_parseo"):
            lines.append(f"  Resumen parseos: {row['detalle_modos_parseo']}")
        if row.get("alertas_lectura"):
            lines.append(f"  ⚠ Alertas automáticas: {row['alertas_lectura']}")

        def _col_key(x: dict) -> int:
            v = x.get("col_movimiento", 0)
            try:
                return int(v)
            except (TypeError, ValueError):
                return 0

        ops = sorted(ops_by.get(key, []), key=_col_key)
        if ops:
            lines.append("  Operaciones en esta fila (orden por columna):")
            for o in ops:
                modo = str(o.get("modo_parseo", ""))
                marcas = ""
                if modo == "line_start_legacy":
                    marcas = " ⚠ RIESGO: cantidad = primer entero al inicio de la celda (p. ej. roscas -5/16, códigos con guión)."
                elif modo == "qty_before_____repaired":
                    marcas = " ✓ Cantidad reparada automáticamente (otro número antes de ____ en la misma celda)."
                elif modo == "_____sin_lectura":
                    marcas = " ⚠ No se extrajo número; esa celda no entró en la suma."
                elif modo == "balance_after____":
                    marcas = " (saldo leído después de ____; verificar si era variación o saldo.)"
                lines.append(
                    f"    · Col {o['col_movimiento']}: delta {o.get('delta', '')!s}  [{modo}]{marcas}"
                )
                if o.get("trozo_celda"):
                    lines.append(f"      Texto: «{o['trozo_celda']}»")
        else:
            lines.append(
                "  (Sin celdas ____ parseadas en el rango; revisa --first-move-col / columna INITIAL inventario.)"
            )

        mals = mal_by.get(key, [])
        if mals:
            lines.append("  Celdas marcadas como lectura problemática:")
            for bad in mals:
                lines.append(
                    f"    → Col {bad['col_movimiento']}: {bad.get('motivo', '')} — {bad.get('modo_parseo', '')}"
                )
        elif not row.get("alertas_lectura"):
            lines.append(
                "  → No hay parse legacy ni ____ sin número; el descuadre puede venir de "
                "snapshots INITIAL QUANTITY intermedios, columnas omitidas, o formato distinto."
            )
        lines.append("")

    return "\n".join(lines)
