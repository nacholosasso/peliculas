# Catálogo de Cine (Nacho & Ailu)

Sitio estático (Firebase Hosting, sitio `cineayn`) que lee un Google Sheet y muestra
el catálogo de películas/series que Nacho y Ailu vieron o tienen pendientes. No usa
ninguna API externa (TMDB/IMDB fue removido): todo sale de la planilla.

Nacho y Ailu son pareja. Nacho nació el 17/07/1997, Ailu el 14/09/2001 (dato solo
para tener presente las edades de cada uno).

- `public/index.html` — markup y Tailwind (vía CDN).
- `public/app.js` — toda la lógica: fetch del Sheet, filtros, tabla, gráficos, modal "¿Qué vemos hoy?".
- Deploy: automático vía GitHub Actions (`.github/workflows/firebase-hosting-deploy.yml`)
  en cada push a `main`. Usa el secret de repo `FIREBASE_SERVICE_ACCOUNT_CINEAYN`
  (service account `github-deploy-cineayn@gen-lang-client-0472064026.iam.gserviceaccount.com`
  con rol `roles/firebasehosting.admin`). No hace falta carpeta local ni `firebase deploy`
  manual: alcanza con editar y pushear (incluso desde github.com o Codespaces).
  `firebase deploy --only hosting` sigue funcionando como alternativa manual si hiciera falta.

## La planilla (Google Sheet)

- Sheet ID: `1tRCbX78IxUEaovLHfyggyiVqV07FLKD-6de3im6QfdI`, hoja `Cine`.
- Se lee vía la API gviz (`SHEET_URL` en `app.js`), no hace falta API key.
- Los headers se mapean por **texto**, no por posición de columna (`normalizarHeader` +
  `CAMPOS_ESPERADOS`), así que agregar/reordenar columnas en el Sheet no rompe nada
  mientras el nombre del header siga siendo reconocible.
- `normalizarHeader` (app.js:86-88) saca espacios, cambia `-` por `_` y borra `_` al
  final. Por eso headers reales como `"Nacho-vio?_"` o `"Fecha-Nacho_"` en la planilla
  terminan matcheando `"Nacho_vio?"` / `"Fecha_Nacho"` en `CAMPOS_ESPERADOS`. Las tablas
  de abajo usan ese nombre ya normalizado (el que usa el código), no el texto literal
  del header en el Sheet.

### Columnas y su significado

| Columna | Significado |
|---|---|
| `Tipo` | Película / Serie / Documental / Cortometraje |
| `Nombre_en_español`, `Nombre_en_ingles` | Títulos. Si falta el español, la fila se ignora (se usa como requisito mínimo). |
| `Año`, `Pais`, `Genero`, `Director`, `Actores_principales` | Datos descriptivos. `Genero` y `Pais` pueden traer varios valores separados por coma (`"Acción, Comedia"`). |
| `Nacho_vio?`, `Ailu_vio?` | `"Si"` (case-insensitive) si esa persona vio la película. Si está vacío, no la vio. |
| `Fecha_Nacho`, `Fecha_Ailu` | Fecha en que cada uno la vio (si la anotaron). |

### Regla clave: "vio = Si" sin fecha es **normal**, no un error

Puede pasar (y pasa seguido) que `Nacho_vio?` o `Ailu_vio?` diga `"Si"` pero la celda
`Fecha_Nacho` / `Fecha_Ailu` esté **vacía**. Esto significa: *la vieron hace tiempo y
no se acuerdan/no anotaron la fecha exacta*, no que falte cargar un dato por error.
Es intencional, se anota igual para tener registro de que ya la vieron.

En el código esto se modela como `sinFechaNacho` / `sinFechaAilu` (`app.js`, dentro de
`cargarPeliculas`): `true` cuando `nachoVio`/`ailuVio` es `true` pero la fecha no
pudo parsearse. Esas filas:

- Muestran el badge rojo "⚠️ Sin fecha" en la tabla.
- Aparecen con el filtro "⚠️ Vista sin fecha registrada" (`vistoFilter`).
- **No** entran en "Últimas 10 Vistas" (requiere fecha para ordenar).
- **No** entran en el gráfico "Vistas por Mes" (se cuenta por fecha, así que sin fecha
  no suma en ningún mes — es el comportamiento esperado, no un bug).

El gráfico "Vistas por Mes" solo muestra el año actual (sin comparar con el año
anterior): años previos tienen muchas vistas sin fecha cargada, así que comparar
contra el año pasado daría una comparación injusta/engañosa.

Cuando se agregue cualquier feature nueva basada en fechas de visto, tener en cuenta
este caso: no asumir que `nachoVio`/`ailuVio` implica que `Fecha_Nacho_Date`/`Fecha_Ailu_Date`
existe.
