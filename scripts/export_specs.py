#!/usr/bin/env python3
"""Exporta el bloque JSON canónico de cada spec.md. Solo usa biblioteca estándar."""
from pathlib import Path
import argparse,json,re,sys
MARKER=re.compile(r"<!-- spec-data:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- spec-data:end -->")
FIELDS=("id","version","name","story","requirements","inputs","process","outputs","businessRules","edgeCases","acceptanceCriteria")
def load_spec(path):
    blocks=MARKER.findall(path.read_text(encoding="utf-8"))
    if len(blocks)!=1: raise ValueError("se requiere exactamente un bloque spec-data JSON")
    data=json.loads(blocks[0])
    if not isinstance(data,dict): raise ValueError("la SPEC debe ser un objeto")
    for key in FIELDS:
        if key not in data: raise ValueError(f"falta {key}")
    for key in ("id","version","name"):
        if not isinstance(data[key],str) or not data[key].strip() or "[" in data[key]: raise ValueError(f"complete {key}")
    story=data["story"]
    if not isinstance(story,dict) or any(not isinstance(story.get(k),str) or not story[k].strip() or "[" in story[k] for k in ("id","as","want","soThat")): raise ValueError("complete la historia")
    for key in ("requirements","inputs","process","outputs","businessRules","edgeCases","acceptanceCriteria"):
        if not isinstance(data[key],list) or not data[key]: raise ValueError(f"complete la lista {key}")
    if any(not isinstance(r,str) or not re.fullmatch(r"(?:RF|RNF)\d{2}",r) for r in data["requirements"]): raise ValueError("referencias RF/RNF inválidas")
    ids=[]
    for ac in data["acceptanceCriteria"]:
        if not isinstance(ac,dict) or any(not isinstance(ac.get(k),str) or not ac[k].strip() or "[" in ac[k] for k in ("id","given","when","then")): raise ValueError("complete los criterios AC")
        ids.append(ac["id"])
    if len(ids)!=len(set(ids)): raise ValueError("AC duplicados")
    return data

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root",default="specs");parser.add_argument("--check",action="store_true")
    args=parser.parse_args();paths=sorted(Path(args.root).rglob("spec.md"));errors=[];seen=set()
    if not paths: errors.append("no hay fuentes spec.md")
    for path in paths:
        try:
            data=load_spec(path)
            if data["id"] in seen: raise ValueError("ID de SPEC duplicado")
            seen.add(data["id"])
            text=json.dumps(data,ensure_ascii=False,indent=2)+"\n";target=path.with_suffix(".json")
            if args.check:
                if not target.exists() or target.read_text(encoding="utf-8")!=text: raise ValueError("spec.json falta o difiere; exporte desde la fuente")
            else: target.write_text(text,encoding="utf-8")
        except (ValueError,OSError) as exc: errors.append(f"{path}: {exc}")
    if errors:
        print("\n".join(errors),file=sys.stderr);return 1
    print(f"{len(paths)} SPECS {'comprobadas' if args.check else 'exportadas'}");return 0
if __name__=="__main__":sys.exit(main())
