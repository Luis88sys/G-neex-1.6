#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Corrige cantidades ya serializadas (coma decimal perdida) en intermediate.json sin volver a leer el xlsx."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from phoenix_sheet_utils import quantity_token_to_float


def repair_qty(q: float | int | object) -> float | object:
    if isinstance(q, bool) or not isinstance(q, (int, float)):
        return q
    if not math.isfinite(q):
        return float(q)
    if abs(q - round(q)) > 1e-9:
        return float(q)
    iq = int(round(q))
    token = str(iq)
    core = token[1:] if token.startswith("-") else token
    if not core.isdigit():
        return float(q)
    abs_i = abs(iq)
    ln = len(core)
    if ln >= 11 and abs_i >= 10**10:
        return quantity_token_to_float(token)
    if ln >= 8 and abs_i >= 5 * 10**7:
        return quantity_token_to_float(token)
    return float(q)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--input",
        type=Path,
        default=Path(__file__).resolve().parent / "generated" / "intermediate_from_HISTORY.json",
    )
    args = ap.parse_args()
    path = args.input.resolve()
    if not path.is_file():
        print(f"No existe: {path}", file=sys.stderr)
        sys.exit(1)
    data = json.loads(path.read_text(encoding="utf-8"))
    changed = 0
    for m in data.get("movements", []):
        for li in m.get("lines", []):
            if "quantity" not in li:
                continue
            old = li["quantity"]
            new = repair_qty(old)
            if new != old:
                changed += 1
                li["quantity"] = new
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: lineas de movimiento corregidas: {changed} -> {path}")


if __name__ == "__main__":
    main()
