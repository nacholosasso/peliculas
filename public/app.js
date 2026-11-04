// Configuración del Google Sheet (debe estar compartido como "Cualquier usuario con el enlace: Lector")
const SHEET_ID = "1tRCbX78IxUEaovLHfyggyiVqV07FLKD-6de3im6QfdI";
const SHEET_NAME = "Cine";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}`;

// Nombres de campo que esperamos encontrar en la hoja "Cine" (se mapean por el texto del header,
// sin importar el orden real de las columnas en el Sheet)
const CAMPOS_ESPERADOS = [
    "Tipo", "Nombre_en_español", "Nombre_en_ingles", "Año", "Pais",
    "Genero", "Director", "Actores_principales", "Nacho_vio?", "Ailu_vio?",
    "Fecha_Nacho", "Fecha_Ailu"
];

const TAMANIO_PAGINA = 24;

// Variables globales para almacenar y filtrar los datos
let peliculas = [];
let datosFiltradosActuales = [];
let datosRenderizados = [];
let cantidadMostrada = 0;

// Instancias de gráficos (para poder destruirlas/recrearlas)
let chartProgreso, chartGeneros, chartMensual, chartPaises;

// Elementos del DOM
const moviesGrid = document.getElementById('moviesGrid');
const moviesTableWrapper = document.getElementById('moviesTableWrapper');
const loader = document.getElementById('loader');
const searchInput = document.getElementById('searchInput');
const tipoFilter = document.getElementById('tipoFilter');
const generoFilter = document.getElementById('generoFilter');
const vistoFilter = document.getElementById('vistoFilter');
const anoFilter = document.getElementById('anoFilter');
const anoModo = document.getElementById('anoModo');
const paisFilter = document.getElementById('paisFilter');
const ordenFilter = document.getElementById('ordenFilter');
const btnLimpiarFiltros = document.getElementById('btnLimpiarFiltros');
const loadMoreContainer = document.getElementById('loadMoreContainer');
const btnCargarMas = document.getElementById('btnCargarMas');

// "Últimas Vistas" elements
const lastSeenByFilter = document.getElementById('lastSeenByFilter');
const lastSeenTypeFilter = document.getElementById('lastSeenTypeFilter');
const ultimasVistasContainer = document.getElementById('ultimasVistasContainer');

// "¿Qué vemos hoy?" elements
const btnAzar = document.getElementById('btnAzar');
const modalAzar = document.getElementById('modalAzar');
const modalAzarContenido = document.getElementById('modalAzarContenido');
const btnOtraVez = document.getElementById('btnOtraVez');
const btnCerrarModal = document.getElementById('btnCerrarModal');
const btnCerrarModal2 = document.getElementById('btnCerrarModal2');

// --- Lógica de Modo Oscuro / Claro ---
const themeToggleBtn = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
const htmlElement = document.documentElement;

// Comprobar preferencias guardadas (modo oscuro por defecto, salvo que el usuario haya elegido claro)
if (localStorage.getItem('theme') === 'light') {
    htmlElement.classList.remove('dark');
} else {
    htmlElement.classList.add('dark');
    themeIcon.classList.replace('fa-moon', 'fa-sun');
}

themeToggleBtn.addEventListener('click', () => {
    htmlElement.classList.toggle('dark');
    if (htmlElement.classList.contains('dark')) {
        localStorage.setItem('theme', 'dark');
        themeIcon.classList.replace('fa-moon', 'fa-sun');
    } else {
        localStorage.setItem('theme', 'light');
        themeIcon.classList.replace('fa-sun', 'fa-moon');
    }
    renderizarGraficos(datosFiltradosActuales.length ? datosFiltradosActuales : peliculas);
});

// Helper para normalizar textos (evita errores con números, quita acentos y pasa a minúsculas)
function normalizarTexto(texto) {
    if (!texto) return "";
    return texto.toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Helper para convertir el header de una columna del Sheet ("Nombre -en-ingles_") al nombre de campo
// que usamos internamente ("Nombre_en_ingles"), sin depender de la posición de la columna.
function normalizarHeader(label) {
    return (label || "").toString().trim().replace(/\s+/g, "").replace(/-/g, "_").replace(/_+$/, "");
}

// Helper para separar valores tipo "Acción, Comedia" en ["Acción", "Comedia"]
function splitLista(valor) {
    return (valor || "").toString().split(',').map(v => v.trim()).filter(v => v);
}

// Helper para convertir DD/MM/YYYY (o el formato de Google Sheets) a un objeto Date
function parseDate(dateValue) {
    if (!dateValue) return null;

    if (dateValue instanceof Date) return dateValue;

    const dateString = dateValue.toString();

    // Formato devuelto por la API gviz de Google Sheets para celdas de tipo Fecha: Date(2024,0,15)
    const gvizMatch = dateString.match(/^Date\((\d+),(\d+),(\d+)/);
    if (gvizMatch) {
        const [, anio, mes, dia] = gvizMatch;
        return new Date(+anio, +mes, +dia);
    }

    // Si tiene formato tradicional DD/MM/YYYY
    if (dateString.includes('/')) {
        const parts = dateString.split('/');
        if (parts.length === 3) {
            const [day, month, year] = parts;
            const date = new Date(+year, +month - 1, +day);
            if (!isNaN(date.getTime())) return date;
        }
    }

    // Intento de lectura estándar para fechas de servidor (ISO)
    const parsed = new Date(dateString);
    return isNaN(parsed.getTime()) ? null : parsed;
}

// Formatea una fecha como DD/MM/YYYY
function formatearFecha(date) {
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Helper para Debounce (optimización del buscador)
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Helper para prevenir XSS (Cross-Site Scripting) escapando HTML
function escapeHTML(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// --- Colores e iconos según Tipo / Género ---
const PALETA_BADGES = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-yellow-500', 'bg-lime-500',
    'bg-green-500', 'bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 'bg-sky-500',
    'bg-blue-500', 'bg-indigo-500', 'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500',
    'bg-pink-500', 'bg-rose-500'];

const PALETA_CHART = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981',
    '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e'];

function colorParaTexto(texto) {
    let hash = 0;
    const cadena = texto.toString();
    for (let i = 0; i < cadena.length; i++) {
        hash = (hash * 31 + cadena.charCodeAt(i)) % PALETA_BADGES.length;
    }
    return PALETA_BADGES[Math.abs(hash) % PALETA_BADGES.length];
}

function iconoPorTipo(tipo) {
    const t = (tipo || "").toLowerCase();
    if (t.includes('serie')) return 'fa-tv';
    if (t.includes('docu')) return 'fa-video';
    if (t.includes('corto')) return 'fa-clapperboard';
    return 'fa-film';
}

// Cargar datos directamente desde el Google Sheet (vía la API gviz)
async function cargarPeliculas() {
    try {
        const response = await fetch(SHEET_URL);
        const texto = await response.text();

        // La respuesta viene envuelta como: /*...*/google.visualization.Query.setResponse({...});
        const json = JSON.parse(texto.substring(texto.indexOf('{'), texto.lastIndexOf('}') + 1));
        const columnas = json.table.cols || [];
        const filas = json.table.rows || [];

        // Mapear cada campo esperado a la posición real de su columna en el Sheet, leyendo los headers.
        // Así, si el día de mañana se agrega/reordena una columna, esto sigue funcionando.
        const indices = {};
        columnas.forEach((col, i) => {
            const nombre = normalizarHeader(col.label);
            if (CAMPOS_ESPERADOS.includes(nombre)) indices[nombre] = i;
        });

        filas.forEach(fila => {
            const celdas = fila.c || [];
            const data = {};
            CAMPOS_ESPERADOS.forEach(campo => {
                const i = indices[campo];
                const celda = (i !== undefined) ? celdas[i] : undefined;
                data[campo] = (celda && celda.v !== null && celda.v !== undefined) ? celda.v : null;
            });

            // Ignorar filas sin nombre de película (igual que hacía el script de sincronización)
            if (!data["Nombre_en_español"]) return;

            const nachoVio = (data["Nacho_vio?"] || "").toString().trim().toLowerCase() === "si";
            const ailuVio = (data["Ailu_vio?"] || "").toString().trim().toLowerCase() === "si";
            const fechaNachoDate = parseDate(data.Fecha_Nacho);
            const fechaAiluDate = parseDate(data.Fecha_Ailu);

            peliculas.push({
                ...data,
                // Limpiar espacios en blanco extra que puedan romper los filtros
                Tipo: (data.Tipo || "").toString().trim(),
                Genero: (data.Genero || "").toString().trim(),
                Pais: (data.Pais || "").toString().trim(),
                Año: (data.Año || "").toString().trim(),
                Fecha_Nacho_Date: fechaNachoDate,
                Fecha_Ailu_Date: fechaAiluDate,
                nachoVio,
                ailuVio,
                // Marcadas como vistas pero sin fecha cargada (dato incompleto en el Sheet)
                sinFechaNacho: nachoVio && !fechaNachoDate,
                sinFechaAilu: ailuVio && !fechaAiluDate
            });
        });

        // Llenar los filtros desplegables automáticamente
        popularFiltros(peliculas);

        // Mostrar resultados
        loader.classList.add('hidden');
        moviesTableWrapper.classList.remove('hidden');
        datosFiltradosActuales = peliculas;
        renderizarUltimasVistas(); // Llamada inicial para las últimas vistas
        renderizarEstadisticas(); // Mostrar las tarjetas de totales
        renderizarGraficos(peliculas); // Mostrar los gráficos
        renderizarPeliculas(peliculas);

    } catch (error) {
        console.error("Error cargando películas: ", error);
        loader.innerHTML = `<p class="text-red-500">Error al cargar el catálogo. Verifica que el Google Sheet esté compartido como "Cualquier usuario con el enlace".</p>`;
    }
}

// Rellenar los <select> con opciones únicas
function popularFiltros(data) {
    const tipos = [...new Set(data.map(p => (p.Tipo || "").toString().trim()).filter(t => t))];

    // Separar géneros y países inteligentemente si vienen varios por celda (Ej: "Acción, Comedia")
    let allGeneros = [];
    let allPaises = [];
    data.forEach(p => {
        allGeneros.push(...splitLista(p.Genero));
        allPaises.push(...splitLista(p.Pais));
    });

    const generos = [...new Set(allGeneros)].sort();
    const anos = [...new Set(data.map(p => p.Año).filter(a => a))].sort((a, b) => b - a);
    const paises = [...new Set(allPaises)].sort();

    tipos.forEach(tipo => {
        tipoFilter.innerHTML += `<option value="${escapeHTML(tipo)}">${escapeHTML(tipo)}</option>`;
        lastSeenTypeFilter.innerHTML += `<option value="${escapeHTML(tipo)}">${escapeHTML(tipo)}</option>`;
    });

    generos.forEach(genero => {
        generoFilter.innerHTML += `<option value="${escapeHTML(genero)}">${escapeHTML(genero)}</option>`;
    });

    anos.forEach(ano => {
        anoFilter.innerHTML += `<option value="${escapeHTML(ano)}">${escapeHTML(ano)}</option>`;
    });

    paises.forEach(pais => {
        paisFilter.innerHTML += `<option value="${escapeHTML(pais)}">${escapeHTML(pais)}</option>`;
    });
}

// Ordena un array de películas según el criterio elegido en "Ordenar por"
function ordenarPeliculas(data, criterio) {
    const arr = [...data];
    switch (criterio) {
        case "anio_desc":
            return arr.sort((a, b) => (parseInt(b.Año) || 0) - (parseInt(a.Año) || 0));
        case "anio_asc":
            return arr.sort((a, b) => (parseInt(a.Año) || 0) - (parseInt(b.Año) || 0));
        case "nombre_asc":
            return arr.sort((a, b) => normalizarTexto(a.Nombre_en_español).localeCompare(normalizarTexto(b.Nombre_en_español)));
        case "nombre_desc":
            return arr.sort((a, b) => normalizarTexto(b.Nombre_en_español).localeCompare(normalizarTexto(a.Nombre_en_español)));
        case "pendientes":
            return arr.sort((a, b) => {
                const aPendiente = (!a.nachoVio && !a.ailuVio) ? 0 : 1;
                const bPendiente = (!b.nachoVio && !b.ailuVio) ? 0 : 1;
                return aPendiente - bPendiente;
            });
        default:
            return arr;
    }
}

// Función principal de filtrado
function aplicarFiltros() {
    const textoBusqueda = normalizarTexto(searchInput.value);
    const tipoSeleccionado = normalizarTexto(tipoFilter.value);
    const generoSeleccionado = normalizarTexto(generoFilter.value);
    const anoSeleccionado = normalizarTexto(anoFilter.value);
    const paisSeleccionado = normalizarTexto(paisFilter.value);
    const vistoSeleccionado = vistoFilter.value;

    let peliculasFiltradas = peliculas.filter(pelicula => {
        // Filtro de Búsqueda (nombre, director, actores)
        const nombreEsp = normalizarTexto(pelicula.Nombre_en_español);
        const nombreIng = normalizarTexto(pelicula.Nombre_en_ingles);
        const director = normalizarTexto(pelicula.Director);
        const actores = normalizarTexto(pelicula.Actores_principales);
        const coincideBusqueda = nombreEsp.includes(textoBusqueda) || nombreIng.includes(textoBusqueda) || director.includes(textoBusqueda) || actores.includes(textoBusqueda);

        // Filtro de Tipo y Género
        const coincideTipo = tipoSeleccionado === "" || normalizarTexto(pelicula.Tipo) === tipoSeleccionado;
        const coincideGenero = generoSeleccionado === "" || normalizarTexto(pelicula.Genero).includes(generoSeleccionado);

        // Filtro de Vistos (asumiendo que en tu sheet "Si" es que la vieron)
        let coincideVisto = true;
        if (vistoSeleccionado === "Nacho") coincideVisto = pelicula.nachoVio && !pelicula.ailuVio;
        if (vistoSeleccionado === "Ailu") coincideVisto = pelicula.ailuVio && !pelicula.nachoVio;
        if (vistoSeleccionado === "Ambos") coincideVisto = pelicula.nachoVio && pelicula.ailuVio;
        if (vistoSeleccionado === "Pendiente") coincideVisto = !pelicula.nachoVio && !pelicula.ailuVio;
        if (vistoSeleccionado === "SinFecha") coincideVisto = pelicula.sinFechaNacho || pelicula.sinFechaAilu;

        // Filtros adicionales
        // Año: "igual" compara exacto; "hasta" / "desde" incluyen el año elegido (<= / >=)
        let coincideAno = true;
        if (anoSeleccionado !== "") {
            if (anoModo.value === "igual") {
                coincideAno = normalizarTexto(pelicula.Año) === anoSeleccionado;
            } else {
                const anioPeli = parseInt(pelicula.Año);
                const anioRef = parseInt(anoSeleccionado);
                coincideAno = !isNaN(anioPeli) && (anoModo.value === "hasta" ? anioPeli <= anioRef : anioPeli >= anioRef);
            }
        }
        const coincidePais = paisSeleccionado === "" || normalizarTexto(pelicula.Pais).includes(paisSeleccionado);

        return coincideBusqueda && coincideTipo && coincideGenero && coincideVisto && coincideAno && coincidePais;
    });

    peliculasFiltradas = ordenarPeliculas(peliculasFiltradas, ordenFilter.value);

    datosFiltradosActuales = peliculasFiltradas;

    renderizarPeliculas(peliculasFiltradas);
    renderizarEstadisticas(peliculasFiltradas); // Actualizar las tarjetas de "Total" dinámicamente
    renderizarGraficos(peliculasFiltradas); // Actualizar los gráficos según el filtro
}

// Crea la fila de tabla (<tr>) de una película
function crearTarjetaPelicula(pelicula) {
    const row = document.createElement('tr');
    row.className = "hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors";

    // Identificadores visuales de quién la vio
    const fechaNachoStr = pelicula.Fecha_Nacho_Date ? ` (${formatearFecha(pelicula.Fecha_Nacho_Date)})` : '';
    const badgeNacho = pelicula.nachoVio ? `<span class="bg-blue-600 text-xs px-2 py-1 rounded-full text-white shadow-sm whitespace-nowrap"><i class="fas fa-check mr-1"></i>Nacho${fechaNachoStr}</span>` : '';

    const fechaAiluStr = pelicula.Fecha_Ailu_Date ? ` (${formatearFecha(pelicula.Fecha_Ailu_Date)})` : '';
    const badgeAilu = pelicula.ailuVio ? `<span class="bg-purple-600 text-xs px-2 py-1 rounded-full text-white shadow-sm whitespace-nowrap"><i class="fas fa-check mr-1"></i>Ailu${fechaAiluStr}</span>` : '';

    const badgePendiente = (!pelicula.nachoVio && !pelicula.ailuVio) ? `<span class="bg-amber-500 text-xs px-2 py-1 rounded-full text-white shadow-sm whitespace-nowrap"><i class="fas fa-clock mr-1"></i>Pendiente</span>` : '';

    const badgeSinFecha = (pelicula.sinFechaNacho || pelicula.sinFechaAilu) ? `<span class="bg-red-500/90 text-xs px-2 py-1 rounded-full text-white shadow-sm whitespace-nowrap" title="Marcada como vista pero sin fecha cargada en el Sheet"><i class="fas fa-triangle-exclamation mr-1"></i>Sin fecha</span>` : '';

    const chipsGenero = splitLista(pelicula.Genero).map(g =>
        `<span class="${colorParaTexto(g)} text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap">${escapeHTML(g)}</span>`
    ).join(' ');

    row.innerHTML = `
        <td class="px-4 py-3 align-top max-w-[240px]">
            <div class="flex items-start gap-2">
                <i class="fas ${iconoPorTipo(pelicula.Tipo)} text-gray-400 dark:text-gray-500 mt-1 flex-shrink-0"></i>
                <div class="overflow-hidden">
                    <p class="font-bold text-gray-900 dark:text-white truncate">${escapeHTML(pelicula.Nombre_en_español || 'Sin título')}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400 italic truncate">${escapeHTML(pelicula.Nombre_en_ingles || '')}</p>
                </div>
            </div>
        </td>
        <td class="px-4 py-3 align-top text-gray-700 dark:text-gray-300 whitespace-nowrap">${escapeHTML(pelicula.Año || '-')}</td>
        <td class="px-4 py-3 align-top"><div class="flex flex-wrap gap-1 max-w-[180px]">${chipsGenero}</div></td>
        <td class="px-4 py-3 align-top text-gray-700 dark:text-gray-300 max-w-[160px] truncate">${escapeHTML(pelicula.Director || '-')}</td>
        <td class="px-4 py-3 align-top text-gray-700 dark:text-gray-300 max-w-[220px] truncate" title="${escapeHTML(pelicula.Actores_principales || '')}">${escapeHTML(pelicula.Actores_principales || '-')}</td>
        <td class="px-4 py-3 align-top text-gray-700 dark:text-gray-300 max-w-[140px] truncate">${escapeHTML(pelicula.Pais || '-')}</td>
        <td class="px-4 py-3 align-top"><div class="flex flex-wrap gap-1">${badgeNacho}${badgeAilu}${badgePendiente}${badgeSinFecha}</div></td>
    `;

    return row;
}

// Dibujar las tarjetas en la pantalla (con paginación)
function renderizarPeliculas(data) {
    moviesGrid.innerHTML = "";
    datosRenderizados = data;
    cantidadMostrada = 0;

    if (data.length === 0) {
        moviesGrid.innerHTML = `<tr><td colspan="7" class="text-center text-gray-600 dark:text-gray-400 py-10">No se encontraron resultados.</td></tr>`;
        loadMoreContainer.classList.add('hidden');
        return;
    }

    cargarMasPeliculas();
}

// Agrega el siguiente lote de tarjetas al grid
function cargarMasPeliculas() {
    const siguienteLote = datosRenderizados.slice(cantidadMostrada, cantidadMostrada + TAMANIO_PAGINA);
    siguienteLote.forEach(pelicula => moviesGrid.appendChild(crearTarjetaPelicula(pelicula)));
    cantidadMostrada += siguienteLote.length;

    if (cantidadMostrada < datosRenderizados.length) {
        loadMoreContainer.classList.remove('hidden');
    } else {
        loadMoreContainer.classList.add('hidden');
    }
}

btnCargarMas.addEventListener('click', cargarMasPeliculas);

// Cargar más automáticamente al hacer scroll cerca del final
const observerCargarMas = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) cargarMasPeliculas();
    });
}, { rootMargin: '300px' });
observerCargarMas.observe(loadMoreContainer);

// Dibujar las tarjetas de "Últimas Vistas"
function renderizarUltimasVistas() {
    const vistoPor = lastSeenByFilter.value;
    const tipo = lastSeenTypeFilter.value;
    const fechaKey = vistoPor === 'Nacho' ? 'Fecha_Nacho_Date' : 'Fecha_Ailu_Date';
    const vioKey = vistoPor === 'Nacho' ? 'nachoVio' : 'ailuVio';

    const ultimasVistas = peliculas
        .filter(p => p[fechaKey] && p[vioKey]) // Debe tener fecha Y decir "SI" en la base de datos
        .filter(p => tipo === "" || (p.Tipo || "").toString().trim() === tipo) // Filtrar por tipo si se seleccionó uno
        .sort((a, b) => b[fechaKey] - a[fechaKey]) // Ordenar por fecha descendente
        .slice(0, 10); // Tomar las últimas 10

    ultimasVistasContainer.innerHTML = ""; // Limpiar contenedor

    if (ultimasVistas.length === 0) {
        ultimasVistasContainer.innerHTML = `<p class="text-gray-600 dark:text-gray-400 p-4">No hay películas recientes para esta selección.</p>`;
        return;
    }

    ultimasVistas.forEach(pelicula => {
        const card = document.createElement('div');
        // Tarjeta más compacta para la lista horizontal
        card.className = "flex-shrink-0 w-64 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-100 dark:border-gray-700 p-4 transition transform hover:-translate-y-1 hover:shadow-lg";

        const fechaVista = formatearFecha(pelicula[fechaKey]);

        card.innerHTML = `
            <span class="text-xs font-bold text-purple-400 uppercase"><i class="fas ${iconoPorTipo(pelicula.Tipo)} mr-1"></i>${escapeHTML(pelicula.Tipo || 'N/A')}</span>
            <h3 class="text-md font-bold text-gray-900 dark:text-white truncate mt-1" title="${escapeHTML(pelicula.Nombre_en_español || '')}">${escapeHTML(pelicula.Nombre_en_español || 'Sin título')}</h3>
            <p class="text-xs text-gray-600 dark:text-gray-400 italic truncate">${escapeHTML(pelicula.Nombre_en_ingles || '')}</p>
            <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <p class="text-xs text-gray-600 dark:text-gray-500">Vista el: <span class="font-semibold text-gray-800 dark:text-gray-300">${fechaVista}</span></p>
            </div>
        `;
        ultimasVistasContainer.appendChild(card);
    });
}

// Dibujar tarjetas de estadísticas globales
function renderizarEstadisticas(datosAProcesar = peliculas) {
    const statsGrid = document.getElementById('statsGrid');
    if (!statsGrid) return;

    const totalContenido = datosAProcesar.length;
    const vistasNacho = datosAProcesar.filter(p => p.nachoVio).length;
    const vistasAilu = datosAProcesar.filter(p => p.ailuVio).length;
    const sinFecha = datosAProcesar.filter(p => p.sinFechaNacho || p.sinFechaAilu).length;

    const conteoTipos = {};
    datosAProcesar.forEach(p => {
        const tipo = p.Tipo ? p.Tipo : "Otro";
        conteoTipos[tipo] = (conteoTipos[tipo] || 0) + 1;
    });

    const crearTarjeta = (titulo, valor, icono, colorClase) => `
        <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm hover:shadow-md border border-gray-100 dark:border-gray-700 flex items-center gap-4 transition-all duration-300 transform hover:-translate-y-1 cursor-default">
            <div class="w-12 h-12 rounded-full ${colorClase} flex items-center justify-center text-white shadow-inner flex-shrink-0">
                <i class="fas ${icono} text-xl"></i>
            </div>
            <div class="overflow-hidden">
                <p class="text-[11px] sm:text-xs text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider truncate" title="${escapeHTML(titulo)}">${escapeHTML(titulo)}</p>
                <p class="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white">${valor}</p>
            </div>
        </div>
    `;

    // 1. Tarjeta Total, 2. Tipos Ordenados, 3. Nacho y Ailu, 4. Sin fecha (si aplica)
    let html = crearTarjeta("Total", totalContenido, "fa-layer-group", "bg-gradient-to-br from-gray-700 to-gray-900 dark:from-gray-500 dark:to-gray-600");
    Object.entries(conteoTipos)
        .filter(([tipo]) => !tipo.toLowerCase().includes('cortometraje')) // Ocultar tarjeta de Cortometrajes
        .sort((a, b) => b[1] - a[1])
        .forEach(([tipo, cantidad]) => {
            html += crearTarjeta(tipo, cantidad, iconoPorTipo(tipo), "bg-gradient-to-br from-indigo-500 to-blue-600");
        });
    html += crearTarjeta("Nacho Vio", vistasNacho, "fa-user-check", "bg-gradient-to-br from-blue-400 to-blue-600");
    html += crearTarjeta("Ailu Vio", vistasAilu, "fa-user-check", "bg-gradient-to-br from-purple-400 to-purple-600");
    if (sinFecha > 0) {
        html += crearTarjeta("Sin fecha", sinFecha, "fa-triangle-exclamation", "bg-gradient-to-br from-red-400 to-red-600");
    }

    statsGrid.innerHTML = html;
}

// Toma las N entradas más frecuentes de un objeto {clave: cantidad}, agrupando el resto en "Otros"
function topEntradas(objeto, n) {
    const entradas = Object.entries(objeto).sort((a, b) => b[1] - a[1]);
    if (entradas.length <= n) return entradas;
    const top = entradas.slice(0, n);
    const otros = entradas.slice(n).reduce((acc, [, v]) => acc + v, 0);
    top.push(['Otros', otros]);
    return top;
}

// Crea o actualiza una instancia de Chart.js
function actualizarChart(instancia, canvasId, config) {
    if (instancia) instancia.destroy();
    const ctx = document.getElementById(canvasId);
    return new Chart(ctx, config);
}

// Dibuja los gráficos de "Análisis del Catálogo"
function renderizarGraficos(data) {
    const esOscuro = htmlElement.classList.contains('dark');
    Chart.defaults.color = esOscuro ? '#d1d5db' : '#374151';
    Chart.defaults.font.family = "ui-sans-serif, system-ui, sans-serif";
    const colorGrilla = esOscuro ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    // --- Progreso de vistas ---
    const ambos = data.filter(p => p.nachoVio && p.ailuVio).length;
    const soloNacho = data.filter(p => p.nachoVio && !p.ailuVio).length;
    const soloAilu = data.filter(p => p.ailuVio && !p.nachoVio).length;
    const pendiente = data.filter(p => !p.nachoVio && !p.ailuVio).length;

    chartProgreso = actualizarChart(chartProgreso, 'chartProgreso', {
        type: 'doughnut',
        data: {
            labels: ['Ambos', 'Solo Nacho', 'Solo Ailu', 'Pendiente'],
            datasets: [{
                data: [ambos, soloNacho, soloAilu, pendiente],
                backgroundColor: ['#10b981', '#3b82f6', '#a855f7', '#f59e0b'],
                borderWidth: 0
            }]
        },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } }
        }
    });

    // --- Top géneros ---
    const conteoGeneros = {};
    data.forEach(p => splitLista(p.Genero).forEach(g => conteoGeneros[g] = (conteoGeneros[g] || 0) + 1));
    const topGeneros = topEntradas(conteoGeneros, 8);

    chartGeneros = actualizarChart(chartGeneros, 'chartGeneros', {
        type: 'bar',
        data: {
            labels: topGeneros.map(([k]) => k),
            datasets: [{ label: 'Películas', data: topGeneros.map(([, v]) => v), backgroundColor: PALETA_CHART, borderRadius: 6 }]
        },
        options: {
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: colorGrilla } },
                y: { grid: { display: false } }
            }
        }
    });

    // --- Vistas por mes (año actual) ---
    const anioActual = new Date().getFullYear();
    const vistasAnioActual = new Array(12).fill(0);

    data.forEach(p => {
        [p.Fecha_Nacho_Date, p.Fecha_Ailu_Date].forEach(fecha => {
            if (fecha && fecha.getFullYear() === anioActual) vistasAnioActual[fecha.getMonth()]++;
        });
    });

    chartMensual = actualizarChart(chartMensual, 'chartMensual', {
        type: 'bar',
        data: {
            labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
            datasets: [
                { label: `${anioActual}`, data: vistasAnioActual, backgroundColor: '#6366f1', borderRadius: 6 }
            ]
        },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: colorGrilla } },
                x: { grid: { display: false } }
            }
        }
    });

    // --- Top países ---
    const conteoPaises = {};
    data.forEach(p => splitLista(p.Pais).forEach(c => conteoPaises[c] = (conteoPaises[c] || 0) + 1));
    const topPaises = topEntradas(conteoPaises, 8);

    chartPaises = actualizarChart(chartPaises, 'chartPaises', {
        type: 'bar',
        data: {
            labels: topPaises.map(([k]) => k),
            datasets: [{ label: 'Películas', data: topPaises.map(([, v]) => v), backgroundColor: [...PALETA_CHART].reverse(), borderRadius: 6 }]
        },
        options: {
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: colorGrilla } },
                y: { grid: { display: false } }
            }
        }
    });
}

// --- "¿Qué vemos hoy?" (selector al azar) ---
function abrirModalAzar() {
    modalAzar.classList.remove('hidden');
    modalAzar.classList.add('flex');
}

function cerrarModalAzar() {
    modalAzar.classList.add('hidden');
    modalAzar.classList.remove('flex');
}

function mostrarPeliculaAlAzar() {
    // Prioridad: pendientes dentro de lo filtrado actualmente -> pendientes globales -> lo filtrado actual
    let pool = datosFiltradosActuales.filter(p => !p.nachoVio && !p.ailuVio);
    if (pool.length === 0) pool = peliculas.filter(p => !p.nachoVio && !p.ailuVio);
    if (pool.length === 0) pool = datosFiltradosActuales.length ? datosFiltradosActuales : peliculas;
    if (pool.length === 0) return;

    const pelicula = pool[Math.floor(Math.random() * pool.length)];

    const chips = splitLista(pelicula.Genero).map(g =>
        `<span class="${colorParaTexto(g)} text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">${escapeHTML(g)}</span>`
    ).join(' ');

    modalAzarContenido.innerHTML = `
        <div class="text-center mb-2">
            <span class="text-xs font-bold uppercase tracking-wider text-blue-500"><i class="fas ${iconoPorTipo(pelicula.Tipo)} mr-1"></i>${escapeHTML(pelicula.Tipo || '')}</span>
        </div>
        <h2 class="text-2xl font-bold text-center text-gray-900 dark:text-white">${escapeHTML(pelicula.Nombre_en_español || 'Sin título')}</h2>
        <h3 class="text-sm text-center text-gray-600 dark:text-gray-400 italic mb-3">${escapeHTML(pelicula.Nombre_en_ingles || '')}${pelicula.Año ? ' · ' + escapeHTML(pelicula.Año) : ''}</h3>
        <div class="flex flex-wrap justify-center gap-1 mb-3">${chips}</div>
        <p class="text-sm text-gray-700 dark:text-gray-300 text-center"><strong>Director:</strong> ${escapeHTML(pelicula.Director || '-')}</p>
        <p class="text-sm text-gray-700 dark:text-gray-300 text-center"><strong>Actores:</strong> ${escapeHTML(pelicula.Actores_principales || '-')}</p>
    `;

    abrirModalAzar();
}

btnAzar.addEventListener('click', mostrarPeliculaAlAzar);
btnOtraVez.addEventListener('click', mostrarPeliculaAlAzar);
btnCerrarModal.addEventListener('click', cerrarModalAzar);
btnCerrarModal2.addEventListener('click', cerrarModalAzar);
modalAzar.addEventListener('click', (e) => {
    if (e.target === modalAzar) cerrarModalAzar();
});

// Cerrar el modal "¿Qué vemos hoy?" con la tecla Escape
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modalAzar.classList.contains('hidden')) cerrarModalAzar();
});

// Event Listeners para los filtros
searchInput.addEventListener('input', debounce(aplicarFiltros, 300));
tipoFilter.addEventListener('change', aplicarFiltros);
generoFilter.addEventListener('change', aplicarFiltros);
vistoFilter.addEventListener('change', aplicarFiltros);
anoFilter.addEventListener('change', aplicarFiltros);
anoModo.addEventListener('change', aplicarFiltros);
paisFilter.addEventListener('change', aplicarFiltros);
ordenFilter.addEventListener('change', aplicarFiltros);

// Limpiar filtros
if (btnLimpiarFiltros) {
    btnLimpiarFiltros.addEventListener('click', () => {
        searchInput.value = '';
        tipoFilter.value = '';
        generoFilter.value = '';
        anoFilter.value = '';
        anoModo.value = 'igual';
        paisFilter.value = '';
        vistoFilter.value = '';
        ordenFilter.value = '';
        aplicarFiltros();
    });
}

// Listeners for "Últimas Vistas"
lastSeenByFilter.addEventListener('change', renderizarUltimasVistas);
lastSeenTypeFilter.addEventListener('change', renderizarUltimasVistas);

// Iniciar
cargarPeliculas();
