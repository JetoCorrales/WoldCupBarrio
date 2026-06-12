# Quiniela Mundial 2026 - bolsa acumulada con página de puntajes

## Archivos importantes

- `index.html`: página administrativa para participantes, pronósticos, resultados y limpieza de datos.
- `results.html`: página pública con detalle de resultados por partido.
- `puntajes.html`: página pública solo para ver los puntajes de los participantes.
- `puntajes.js`: lógica de solo lectura para cargar y calcular el ranking.
- `config.js`: conexión con Cloudflare Worker.
- `cloudflare_worker_quiniela_puntos.js`: código del Worker si necesitas reinstalarlo.

## URL de la nueva página

Después de subir los archivos a GitHub Pages, la página de puntajes quedará en:

```txt
https://jetocorrales.github.io/mundial/puntajes.html
```

## ¿Necesita cambios en el Worker?

No. La página `puntajes.html` solo hace una solicitud `GET` al endpoint `/api/betData`.
No guarda, no limpia y no modifica datos.

## Pasos para subir

1. Descomprime este ZIP.
2. Sube todos los archivos al repositorio `mundial`.
3. Reemplaza los archivos anteriores.
4. Abre la página:

```txt
https://jetocorrales.github.io/mundial/puntajes.html
```

5. Presiona `Ctrl + F5` para evitar caché.

## Confirmación rápida

La página debe mostrar:

- Participantes registrados.
- Acumulado actual.
- Partidos con resultado.
- Ranking ordenado por puntos ganados.
- Botón `Actualizar puntajes`.

Esta página es solo de lectura.
