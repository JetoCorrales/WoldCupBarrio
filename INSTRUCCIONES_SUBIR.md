# Quiniela Mundial 2026 - versión con página pública solo consulta

## Qué cambió

Se ajustó `results.html` para que sea una página pública de consulta.

Esta página:

- Solo lee datos desde Cloudflare Worker mediante `GET`.
- No tiene formularios.
- No agrega participantes.
- No registra pronósticos.
- No registra resultados.
- No limpia datos.
- No usa `POST`.
- No usa `localStorage`.
- No muestra enlace de administración.

La página de puntajes `puntajes.html` también queda como página pública de consulta y se quitó el enlace a la administración.

## URLs públicas

Resultados:

```txt
https://jetocorrales.github.io/mundial/results.html
```

Puntajes:

```txt
https://jetocorrales.github.io/mundial/puntajes.html
```

## URL administrativa

La administración sigue estando en:

```txt
https://jetocorrales.github.io/mundial/index.html
```

Importante: GitHub Pages es público. Aunque no se muestre el enlace en las páginas públicas, cualquier persona que conozca la URL `index.html` podría abrirla.

Para seguridad real, el Worker debe proteger los métodos de escritura `POST` con token o mover la administración a un entorno privado.

## Cómo subir

1. Descomprime el ZIP.
2. Sube todos los archivos al repositorio `mundial`.
3. Reemplaza los archivos anteriores.
4. Abre `results.html` y presiona `Ctrl + F5`.

## Verificación técnica

En la página pública abre DevTools > Network y confirma que `api/betData` se llama con método:

```txt
GET
```

No debe aparecer ninguna llamada `POST` desde `results.html` ni desde `puntajes.html`.


## Corrección incluida

La página pública `results.html` ahora ordena `matches.json` cronológicamente igual que la página administrativa.
Esto evita que un resultado guardado con el índice del calendario administrativo se muestre sobre otro partido en la vista pública.
