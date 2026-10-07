# Starter del examen NexoEntrega 360

Esta estructura prepara archivos y revisiones. No trae lógica de negocio, API, interfaz, base implementada ni un pipeline que se pueda anunciar como aprobado.

1. Copie el contenido en un repositorio vacío o adapte el suyo. Copie los anexos pertinentes a docs, contracts y evidence.
2. Cree cinco carpetas bajo specs y copie spec-source-template.md como spec.md en cada una. Complete el único bloque JSON canónico y el contexto/revisión. Mantenga los IDs al evolucionar.
3. Ejecute `python3 scripts/export_specs.py` desde la raíz. Genere y versione spec.json junto a cada fuente. Ejecute `python3 scripts/export_specs.py --check` en CI después del checkout; no exporte antes del check, porque ocultaría una diferencia.
4. Revise SPEC, arquitectura, contrato y tareas antes de implementar cada funcionalidad. El comprobador valida formato básico y coincidencia; una revisión humana debe verificar reglas, contenido y cobertura.
5. Elija su stack y añada sus dependencias fijadas, aplicación, migraciones, datos, pruebas reales y pipeline. Conserve fallos visibles. Estas carpetas vacías no cuentan como evidencia.
6. Documente comandos efectivos de arranque, test, carga y recuperación en el runbook. CI debe comprobar también contratos, formato/tipos, pruebas contra base real y build. Un check de SPECS por sí solo no verifica el producto.

Con Python disponible, no se necesitan paquetes adicionales para el exportador. Make es opcional. Puede reemplazar el mecanismo de exportación por otro reproducible, manteniendo una sola fuente y comprobación de coincidencia.
