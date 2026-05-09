#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fusiona inventario derivado de Phoenix con:

- **Respaldo JSON G-NEEX** (`exportedAt` + `data.phoenix-inventory`): las **cantidades**
  fiables (`mainStock` / `prodStock` / `transStock`) deben salir de aquí, no del CSV
  ni de INITIAL QUANTITY en Excel.

- **CSV exportado** desde G-NEEX: solo **metadatos** (ubicación, id, cajas, proveedor,
  fechas, lotes, etc.); **no** sobrescribe stocks (el CSV puede estar desfasado).
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any


def parse_float(val: Any, default: float = 0.0) -> float:
    if val is None:
        return default
    s = str(val).strip()
    if not s:
        return default
    try:
        return float(s.replace(",", "."))
    except (TypeError, ValueError):
        return default


def parse_int(val: Any, default: int = 0) -> int:
    if val is None:
        return default
    s = str(val).strip()
    if not s:
        return default
    try:
        return int(float(s.replace(",", ".")))
    except (TypeError, ValueError):
        return default


def load_gneex_inventory_by_code(path: Path) -> dict[str, dict[str, str]]:
    """Codigo (lower) -> fila completa del CSV."""
    by_code: dict[str, dict[str, str]] = {}
    p = path.expanduser().resolve()
    with p.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return by_code
        for row in reader:
            code = (row.get("Codigo") or "").strip()
            if not code:
                continue
            by_code[code.lower()] = {
                k: ("" if v is None else str(v)) for k, v in row.items()
            }
    return by_code


def load_gneex_inventory_from_backup_json(path: Path) -> dict[str, dict[str, Any]]:
    """code (lower) -> objeto artículo tal como en localStorage (phoenix-inventory)."""
    p = path.expanduser().resolve()
    root = json.loads(p.read_text(encoding="utf-8"))
    data = root.get("data") or {}
    raw = data.get("phoenix-inventory")
    if raw is None:
        return {}
    if isinstance(raw, str):
        try:
            arr = json.loads(raw)
        except json.JSONDecodeError:
            return {}
    elif isinstance(raw, list):
        arr = raw
    else:
        return {}
    by_code: dict[str, dict[str, Any]] = {}
    for item in arr:
        if not isinstance(item, dict):
            continue
        code = (item.get("code") or "").strip()
        if not code:
            continue
        by_code[code.lower()] = item
    return by_code


_LEGACY_CSV_STOCK_NOTE = " Fusionado desde CSV G-NEEX de referencia (stock y campos fiables)."
_LEGACY_NO_CSV_OLD = (
    " ⚠ Sin fila en CSV G-NEEX de referencia: el stock sigue saliendo de Phoenix "
    "(INITIAL QUANTITY); añade el código al CSV o ignora si es correcto."
)


def merge_inv_list_stocks_from_gneex_backup(
    inv_list: list[dict],
    backup_path: Path,
) -> tuple[list[dict], dict[str, int]]:
    """
    Para cada código presente en el respaldo G-NEEX, alinea **todo** el artículo con ese
    snapshot final (stocks, ubicación, id, cajas, proveedor, etc.). Es la fuente única de
    “stock final” y metadatos coherentes con la app en el momento del respaldo.
    """
    by_code = load_gneex_inventory_from_backup_json(backup_path)
    stats = {"from_backup_final": 0, "phoenix_only": 0}
    out: list[dict] = []
    for it in inv_list:
        merged = dict(it)
        n0 = (merged.get("notes") or "").replace(_LEGACY_CSV_STOCK_NOTE, "").strip()
        merged["notes"] = n0
        key = (it.get("code") or "").strip().lower()
        b = by_code.get(key)
        if b:
            stats["from_backup_final"] += 1
            bid = str(b.get("id") or "").strip()
            if bid:
                merged["id"] = bid
            merged["description"] = str(b.get("description") or merged.get("description", "")).strip()
            merged["category"] = str(b.get("category") or merged.get("category", "")).strip()
            merged["mainStock"] = parse_float(b.get("mainStock"), merged.get("mainStock", 0))
            merged["prodStock"] = parse_float(b.get("prodStock"), 0)
            merged["transStock"] = parse_float(b.get("transStock"), 0)
            merged["location"] = str(b.get("location") or "").strip()
            merged["qtyPerBox"] = parse_float(b.get("qtyPerBox"), 0)
            merged["numBoxes"] = parse_float(b.get("numBoxes"), 0)
            merged["expDate"] = str(b.get("expDate") or "").strip()
            merged["daysToExpire"] = parse_int(b.get("daysToExpire"), 0)
            merged["expirationDate"] = str(b.get("expirationDate") or "").strip()
            merged["supplier"] = str(b.get("supplier") or "").strip()
            merged["lastOrder"] = str(b.get("lastOrder") or "").strip()
            merged["details"] = str(b.get("details") or "").strip()
            ex = b.get("expirations")
            if isinstance(ex, list):
                merged["expirations"] = ex
            elif not isinstance(merged.get("expirations"), list):
                merged["expirations"] = []
            merged["minStock"] = parse_float(b.get("minStock"), parse_float(merged.get("minStock"), 0))
            merged["maxStock"] = parse_float(b.get("maxStock"), parse_float(merged.get("maxStock"), 0))
            merged["shelfLifeMonths"] = parse_int(b.get("shelfLifeMonths"), parse_int(merged.get("shelfLifeMonths"), 0))
            merged["notes"] = (
                "Origen Phoenix (movimientos). Inventario alineado con respaldo G-NEEX final."
            )
        else:
            stats["phoenix_only"] += 1
            merged["notes"] = (
                (merged.get("notes") or "").strip()
                + " ⚠ Sin artículo en respaldo G-NEEX: cantidades desde Phoenix (INITIAL QUANTITY)."
            ).strip()
        out.append(merged)
    return out, stats


def merge_flat_csv_rows_stocks_from_gneex_backup(
    rows: list[dict[str, Any]],
    backup_path: Path,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    by_code = load_gneex_inventory_from_backup_json(backup_path)
    stats = {"from_backup_final": 0, "phoenix_only": 0}
    out: list[dict[str, Any]] = []
    for row in rows:
        key = (row.get("Codigo") or "").strip().lower()
        b = by_code.get(key)
        new_r = dict(row)
        if b:
            stats["from_backup_final"] += 1
            new_r["StockPrincipal"] = parse_float(b.get("mainStock"), parse_float(row.get("StockPrincipal"), 0))
            new_r["StockProduccion"] = parse_float(b.get("prodStock"), 0)
            new_r["StockTransformacion"] = parse_float(b.get("transStock"), 0)
            new_r["Descripcion"] = str(b.get("description") or new_r.get("Descripcion", "")).strip()
            new_r["Categoria"] = str(b.get("category") or new_r.get("Categoria", "")).strip()
            new_r["Ubicacion"] = str(b.get("location") or "").strip()
            new_r["CantidadPorCaja"] = parse_float(b.get("qtyPerBox"), 0)
            new_r["NumeroCajas"] = parse_float(b.get("numBoxes"), 0)
            new_r["FechaExpedicion"] = str(b.get("expDate") or "").strip()
            new_r["DiasParaExpirar"] = str(parse_int(b.get("daysToExpire"), 0))
            new_r["FechaExpiracion"] = str(b.get("expirationDate") or "").strip()
            new_r["Proveedor"] = str(b.get("supplier") or "").strip()
            new_r["UltimaOrden"] = str(b.get("lastOrder") or "").strip()
            new_r["Detalles"] = str(b.get("details") or "").strip()
            if b.get("id"):
                new_r["Id"] = str(b.get("id")).strip()
            new_r["Notas"] = "Inventario alineado con respaldo G-NEEX final."
        else:
            stats["phoenix_only"] += 1
            new_r["Notas"] = (
                (new_r.get("Notas") or "").strip() + " ⚠ Sin artículo en respaldo: stock desde Phoenix."
            ).strip()
        out.append(new_r)
    return out, stats


def _parse_lotes_json(s: str) -> list:
    s = (s or "").strip()
    if not s:
        return []
    try:
        j = json.loads(s)
        return j if isinstance(j, list) else []
    except json.JSONDecodeError:
        return []


def merge_inv_list_from_gneex_csv(
    inv_list: list[dict],
    csv_path: Path,
) -> tuple[list[dict], dict[str, int]]:
    """
    Metadatos desde CSV G-NEEX (mismo Codigo). **No** copia cantidades de stock
    del CSV; usar `merge_inv_list_stocks_from_gneex_backup` para eso.
    """
    csv_by = load_gneex_inventory_by_code(csv_path)
    stats = {"metadata_from_csv": 0, "no_csv_row": 0}
    out: list[dict] = []
    for it in inv_list:
        key = (it.get("code") or "").strip().lower()
        row = csv_by.get(key)
        merged = dict(it)
        merged["notes"] = (
            (merged.get("notes") or "")
            .replace(_LEGACY_CSV_STOCK_NOTE, "")
            .replace(_LEGACY_NO_CSV_OLD, "")
            .strip()
        )
        if row:
            stats["metadata_from_csv"] += 1
            if (row.get("Descripcion") or "").strip():
                merged["description"] = str(row["Descripcion"]).strip()
            if (row.get("Categoria") or "").strip():
                merged["category"] = str(row["Categoria"]).strip()
            if (row.get("Ubicacion") or "").strip():
                merged["location"] = str(row["Ubicacion"]).strip()
            gid = (row.get("Id") or "").strip()
            if gid:
                merged["id"] = gid
            merged["qtyPerBox"] = parse_float(row.get("CantidadPorCaja"), merged.get("qtyPerBox", 0) or 0)
            merged["numBoxes"] = parse_float(row.get("NumeroCajas"), merged.get("numBoxes", 0) or 0)
            merged["expDate"] = str(row.get("FechaExpedicion") or "").strip()
            merged["daysToExpire"] = parse_int(row.get("DiasParaExpirar"), merged.get("daysToExpire", 0) or 0)
            merged["expirationDate"] = str(row.get("FechaExpiracion") or "").strip()
            merged["supplier"] = str(row.get("Proveedor") or "").strip()
            merged["lastOrder"] = str(row.get("UltimaOrden") or "").strip()
            merged["details"] = str(row.get("Detalles") or "").strip()
            merged["minStock"] = parse_float(row.get("StockMinimo"), merged.get("minStock", 0) or 0)
            merged["maxStock"] = parse_float(row.get("StockMaximo"), merged.get("maxStock", 0) or 0)
            merged["shelfLifeMonths"] = parse_int(row.get("VidaUtilMeses"), merged.get("shelfLifeMonths", 0) or 0)
            merged["expirations"] = _parse_lotes_json(row.get("LotesJson") or "[]")
            merged["notes"] = (
                (merged.get("notes") or "").strip()
                + " Complemento CSV: ubicación, lotes, min/max… (cantidades de stock sin cambiar)."
            ).strip()
        else:
            stats["no_csv_row"] += 1
            merged["notes"] = (
                (merged.get("notes") or "").strip() + " ⚠ Sin fila en CSV G-NEEX: metadatos solo desde Phoenix/respaldo."
            ).strip()
        out.append(merged)
    return out, stats


def merge_flat_csv_rows_from_gneex_csv(
    rows: list[dict[str, Any]],
    csv_path: Path,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Metadatos desde CSV; no modifica StockPrincipal / Producion / Transformacion."""
    csv_by = load_gneex_inventory_by_code(csv_path)
    stats = {"metadata_from_csv": 0, "no_csv_row": 0}
    out: list[dict[str, Any]] = []
    for row in rows:
        key = (row.get("Codigo") or "").strip().lower()
        ref = csv_by.get(key)
        if not ref:
            stats["no_csv_row"] += 1
            new_r = dict(row)
            new_r["Notas"] = (new_r.get("Notas") or "").strip() + (
                " ⚠ Sin fila en CSV G-NEEX (metadatos)."
            )
            out.append(new_r)
            continue
        stats["metadata_from_csv"] += 1
        new_r = dict(row)
        if (ref.get("Descripcion") or "").strip():
            new_r["Descripcion"] = str(ref["Descripcion"]).strip()
        if (ref.get("Categoria") or "").strip():
            new_r["Categoria"] = str(ref["Categoria"]).strip()
        if (ref.get("Ubicacion") or "").strip():
            new_r["Ubicacion"] = str(ref["Ubicacion"]).strip()
        if (ref.get("Id") or "").strip():
            new_r["Id"] = str(ref["Id"]).strip()
        new_r["CantidadPorCaja"] = parse_float(ref.get("CantidadPorCaja"), parse_float(row.get("CantidadPorCaja"), 0))
        new_r["NumeroCajas"] = parse_float(ref.get("NumeroCajas"), parse_float(row.get("NumeroCajas"), 0))
        new_r["FechaExpedicion"] = str(ref.get("FechaExpedicion") or "").strip()
        new_r["DiasParaExpirar"] = str(parse_int(ref.get("DiasParaExpirar"), parse_int(row.get("DiasParaExpirar"), 0)))
        new_r["FechaExpiracion"] = str(ref.get("FechaExpiracion") or "").strip()
        new_r["Proveedor"] = str(ref.get("Proveedor") or "").strip()
        new_r["UltimaOrden"] = str(ref.get("UltimaOrden") or "").strip()
        new_r["Detalles"] = str(ref.get("Detalles") or "").strip()
        new_r["StockMinimo"] = parse_float(ref.get("StockMinimo"), parse_float(row.get("StockMinimo"), 0))
        new_r["StockMaximo"] = parse_float(ref.get("StockMaximo"), parse_float(row.get("StockMaximo"), 0))
        new_r["VidaUtilMeses"] = parse_int(ref.get("VidaUtilMeses"), parse_int(row.get("VidaUtilMeses"), 0))
        new_r["LotesJson"] = ref.get("LotesJson") or row.get("LotesJson") or "[]"
        new_r["Notas"] = (new_r.get("Notas") or "").strip() + " Metadatos desde CSV (stocks no del CSV)."
        out.append(new_r)
    return out, stats
