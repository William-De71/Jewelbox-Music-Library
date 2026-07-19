#!/usr/bin/env python3
"""Turns a Vitest json-summary coverage report into a markdown summary.

Usage: coverage_summary.py <coverage-summary.json> [--gate 90]
Prints markdown on stdout: total line coverage plus a per-file table.
The report only contains the modules selected in vitest.config.js (the ones
the suite actually drives), so the table stays short.

Mirrors .github/scripts/kover_summary.py in the Android player repo, so both
projects report coverage the same way on their pull requests.
"""
import json
import sys


def pct(covered, total):
    return 100.0 * covered / total if total else 100.0


def main(path, gate):
    with open(path, encoding="utf-8") as handle:
        report = json.load(handle)

    total = report.pop("total")["lines"]
    total_pct = total["pct"]
    badge = "✅" if total_pct >= gate else "❌"

    # Paths are absolute in the report: keep the part below src/ so the table
    # reads like the repo layout (db/queries.js, routes/player.js…).
    rows = {}
    for path_key, metrics in report.items():
        name = path_key.split("/src/")[-1]
        lines = metrics["lines"]
        rows[name] = (lines["covered"], lines["total"])

    def table(entries):
        out = ["| Fichier | Lignes | % |", "|---|---:|---:|"]
        for name, (covered, count) in entries:
            out.append(f"| `{name}` | {covered}/{count} | {pct(covered, count):.1f}% |")
        return "\n".join(out)

    by_pct = sorted(rows.items(), key=lambda r: pct(*r[1]))
    incomplete = [(name, counts) for name, counts in by_pct if counts[0] < counts[1]]
    missed = total["total"] - total["covered"]

    # Compact by default: the total, then only what needs attention; the full
    # per-file table stays one click away in a collapsed block.
    print(f"### 📊 Couverture des lignes (serveur) : **{total_pct:.1f}%** {badge} <sub>(gate : {gate} %)</sub>")
    print()
    if incomplete:
        print(f"{missed} ligne(s) manquée(s) dans {len(incomplete)} fichier(s) :")
        print()
        print(table(incomplete))
    else:
        print("Tous les fichiers mesurés sont à 100 %. 🎉")
    print()
    print("<details>")
    print(f"<summary>Détail des {len(rows)} fichiers mesurés</summary>")
    print()
    print(table(by_pct))
    print()
    print("</details>")


if __name__ == "__main__":
    args = sys.argv[1:]
    gate_value = 90
    if "--gate" in args:
        index = args.index("--gate")
        gate_value = float(args[index + 1])
        del args[index:index + 2]
    main(args[0], gate_value)
