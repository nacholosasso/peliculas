import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";

// Configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyArQtCJOCiz_kiuXI2hBCYzYqj6GOYa9M4",
  authDomain: "gen-lang-client-0472064026.firebaseapp.com",
  projectId: "gen-lang-client-0472064026",
  storageBucket: "gen-lang-client-0472064026.firebasestorage.app",
  messagingSenderId: "910229014306",
  appId: "1:910229014306:web:34a5afa59f586ca230c77b",
  measurementId: "G-M8X0DTYE4V"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);

// Variables globales para almacenar y filtrar los datos
let peliculas = [];

// Elementos del DOM
const moviesGrid = document.getElementById('moviesGrid');
const loader = document.getElementById('loader');
const searchInput = document.getElementById('searchInput');
const tipoFilter = document.getElementById('tipoFilter');
const generoFilter = document.getElementById('generoFilter');
const vistoFilter = document.getElementById('vistoFilter');
const anoFilter = document.getElementById('anoFilter');
const paisFilter = document.getElementById('paisFilter');
const btnLimpiarFiltros = document.getElementById('btnLimpiarFiltros');

// "Últimas Vistas" elements
const lastSeenByFilter = document.getElementById('lastSeenByFilter');
const lastSeenTypeFilter = document.getElementById('lastSeenTypeFilter');
const ultimasVistasContainer = document.getElementById('ultimasVistasContainer');

// --- Lógica de Modo Oscuro / Claro ---
const themeToggleBtn = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
const htmlElement = document.documentElement;

// Comprobar preferencias guardadas
if (localStorage.getItem('theme') === 'dark') {
    htmlElement.classList.add('dark');
    themeIcon.classList.replace('fa-moon', 'fa-sun');
} else {
    htmlElement.classList.remove('dark');
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
});

// Helper para normalizar textos (evita errores con números, quita acentos y pasa a minúsculas)
function normalizarTexto(texto) {
    if (!texto) return "";
    return texto.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Helper para convertir DD/MM/YYYY a un objeto Date
function parseDate(dateValue) {
    if (!dateValue) return null;
    
    // Si es un Timestamp de Firestore o un Date nativo
    if (dateValue.toDate) return dateValue.toDate();
    if (dateValue instanceof Date) return dateValue;

    const dateString = dateValue.toString();
    
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

// Cargar datos desde Firestore
async function cargarPeliculas() {
    try {
        const querySnapshot = await getDocs(collection(db, "Cine")); // Ahora busca en la colección "Cine"
        
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            peliculas.push({ 
                id: doc.id, 
                ...data,
                // Limpiar espacios en blanco extra que puedan romper los filtros
                Tipo: (data.Tipo || "").toString().trim(),
                Genero: (data.Genero || "").toString().trim(),
                Pais: (data.Pais || "").toString().trim(),
                Año: (data.Año || "").toString().trim(),
                Fecha_Nacho_Date: parseDate(data.Fecha_Nacho),
                Fecha_Ailu_Date: parseDate(data.Fecha_Ailu),
                nachoVio: (data["Nacho_vio?"] || "").toString().trim().toLowerCase() === "si",
                ailuVio: (data["Ailu_vio?"] || "").toString().trim().toLowerCase() === "si"
            });
        });

        // Llenar los filtros desplegables automáticamente
        popularFiltros(peliculas);
        
        // Mostrar resultados
        loader.classList.add('hidden');
        moviesGrid.classList.remove('hidden');
        renderizarUltimasVistas(); // Llamada inicial para las últimas vistas
        renderizarEstadisticas(); // Mostrar las tarjetas de totales
        renderizarPeliculas(peliculas);

    } catch (error) {
        console.error("Error cargando películas: ", error);
        loader.innerHTML = `<p class="text-red-500">Error al cargar la base de datos. Verifica tu conexión y configuración.</p>`;
    }
}

// Rellenar los <select> con opciones únicas
function popularFiltros(data) {
    const tipos = [...new Set(data.map(p => (p.Tipo || "").toString().trim()).filter(t => t))];
    
    // Separar géneros y países inteligentemente si vienen varios por celda (Ej: "Acción, Comedia")
    let allGeneros = [];
    let allPaises = [];
    data.forEach(p => {
        if (p.Genero) allGeneros.push(...p.Genero.toString().split(',').map(g => g.trim()).filter(g => g));
        if (p.Pais) allPaises.push(...p.Pais.toString().split(',').map(x => x.trim()).filter(x => x));
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

// Función principal de filtrado
function aplicarFiltros() {
    const textoBusqueda = normalizarTexto(searchInput.value);
    const tipoSeleccionado = normalizarTexto(tipoFilter.value);
    const generoSeleccionado = normalizarTexto(generoFilter.value);
    const anoSeleccionado = normalizarTexto(anoFilter.value);
    const paisSeleccionado = normalizarTexto(paisFilter.value);
    const vistoSeleccionado = vistoFilter.value;

    const peliculasFiltradas = peliculas.filter(pelicula => {
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

        // Filtros adicionales
        const coincideAno = anoSeleccionado === "" || normalizarTexto(pelicula.Año) === anoSeleccionado;
        const coincidePais = paisSeleccionado === "" || normalizarTexto(pelicula.Pais).includes(paisSeleccionado);

        return coincideBusqueda && coincideTipo && coincideGenero && coincideVisto && coincideAno && coincidePais;
    });

    renderizarPeliculas(peliculasFiltradas);
    renderizarEstadisticas(peliculasFiltradas); // Actualizar las tarjetas de "Total" dinámicamente
}

// Dibujar las tarjetas en la pantalla
function renderizarPeliculas(data) {
    moviesGrid.innerHTML = "";
    
    if (data.length === 0) {
        moviesGrid.innerHTML = `<p class="col-span-full text-center text-gray-600 dark:text-gray-400">No se encontraron resultados.</p>`;
        return;
    }

    data.forEach(pelicula => {
        const card = document.createElement('div');
        card.className = "bg-white dark:bg-gray-800 rounded-xl overflow-hidden shadow border border-gray-100 dark:border-gray-700 transition transform hover:-translate-y-1 hover:shadow-xl";
        
        // Identificadores visuales de quién la vio
        const fechaNachoStr = pelicula.Fecha_Nacho_Date ? ` (${pelicula.Fecha_Nacho_Date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })})` : '';
        const badgeNacho = pelicula.nachoVio ? `<span class="bg-blue-600 text-xs px-2 py-1 rounded-full text-white shadow-sm"><i class="fas fa-check mr-1"></i>Nacho${fechaNachoStr}</span>` : '';
        
        const fechaAiluStr = pelicula.Fecha_Ailu_Date ? ` (${pelicula.Fecha_Ailu_Date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })})` : '';
        const badgeAilu = pelicula.ailuVio ? `<span class="bg-purple-600 text-xs px-2 py-1 rounded-full text-white shadow-sm"><i class="fas fa-check mr-1"></i>Ailu${fechaAiluStr}</span>` : '';
        const badgePendiente = (!pelicula.nachoVio && !pelicula.ailuVio) ? `<span class="bg-amber-500 text-xs px-2 py-1 rounded-full text-white shadow-sm"><i class="fas fa-clock mr-1"></i>Pendiente</span>` : '';

        card.innerHTML = `
            <div class="p-6">
                <div class="flex justify-between items-start mb-4">
                    <span class="text-xs font-bold text-blue-400 uppercase tracking-wider">${escapeHTML(pelicula.Tipo || 'N/A')}</span>
                    <span class="text-xs text-gray-500">${escapeHTML(pelicula.Año || '')}</span>
                </div>
                <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-1">${escapeHTML(pelicula.Nombre_en_español || 'Sin título')}</h2>
                <h3 class="text-sm text-gray-600 dark:text-gray-400 mb-4 italic">${escapeHTML(pelicula.Nombre_en_ingles || '')}</h3>
                
                <div class="mb-4">
                    <p class="text-sm text-gray-700 dark:text-gray-300"><strong class="text-gray-900 dark:text-gray-500">Género:</strong> ${escapeHTML(pelicula.Genero || '-')}</p>
                    <p class="text-sm text-gray-700 dark:text-gray-300"><strong class="text-gray-900 dark:text-gray-500">Director:</strong> ${escapeHTML(pelicula.Director || '-')}</p>
                    <p class="text-sm text-gray-700 dark:text-gray-300"><strong class="text-gray-900 dark:text-gray-500">Actores principales:</strong> ${escapeHTML(pelicula.Actores_principales || '-')}</p>
                </div>
                
                <div class="flex gap-2 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    ${badgeNacho}
                    ${badgeAilu}
                    ${badgePendiente}
                </div>
            </div>
        `;
        moviesGrid.appendChild(card);
    });
}

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
        
        const fechaVista = pelicula[fechaKey].toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

        card.innerHTML = `
            <span class="text-xs font-bold text-purple-400 uppercase">${escapeHTML(pelicula.Tipo || 'N/A')}</span>
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

    // Asignar iconos de FontAwesome según la palabra clave
    const getIcono = (tipo) => {
        const t = tipo.toLowerCase();
        if(t.includes('pel')) return 'fa-film';
        if(t.includes('serie')) return 'fa-tv';
        if(t.includes('docu')) return 'fa-video';
        return 'fa-play';
    };

    // 1. Tarjeta Total, 2. Tipos Ordenados, 3. Nacho y Ailu
    let html = crearTarjeta("Total", totalContenido, "fa-layer-group", "bg-gradient-to-br from-gray-700 to-gray-900 dark:from-gray-500 dark:to-gray-600");
    Object.entries(conteoTipos)
        .filter(([tipo]) => !tipo.toLowerCase().includes('cortometraje')) // Ocultar tarjeta de Cortometrajes
        .sort((a, b) => b[1] - a[1])
        .forEach(([tipo, cantidad]) => {
            html += crearTarjeta(tipo, cantidad, getIcono(tipo), "bg-gradient-to-br from-indigo-500 to-blue-600");
        });
    html += crearTarjeta("Nacho Vio", vistasNacho, "fa-user-check", "bg-gradient-to-br from-blue-400 to-blue-600");
    html += crearTarjeta("Ailu Vio", vistasAilu, "fa-user-check", "bg-gradient-to-br from-purple-400 to-purple-600");

    statsGrid.innerHTML = html;
}

// Event Listeners para los filtros
searchInput.addEventListener('input', debounce(aplicarFiltros, 300));
tipoFilter.addEventListener('change', aplicarFiltros);
generoFilter.addEventListener('change', aplicarFiltros);
vistoFilter.addEventListener('change', aplicarFiltros);
anoFilter.addEventListener('change', aplicarFiltros);
paisFilter.addEventListener('change', aplicarFiltros);

// Limpiar filtros
if (btnLimpiarFiltros) {
    btnLimpiarFiltros.addEventListener('click', () => {
        searchInput.value = '';
        tipoFilter.value = '';
        generoFilter.value = '';
        anoFilter.value = '';
        paisFilter.value = '';
        vistoFilter.value = '';
        aplicarFiltros();
    });
}

// Listeners for "Últimas Vistas"
lastSeenByFilter.addEventListener('change', renderizarUltimasVistas);
lastSeenTypeFilter.addEventListener('change', renderizarUltimasVistas);

// Iniciar
cargarPeliculas();