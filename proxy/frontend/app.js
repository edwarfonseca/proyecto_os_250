'use strict';
// Interfaz mínima de EntregaSegura. Toda la seguridad está en el servidor:
// esta página solo muestra u oculta botones por comodidad.
// Se construye el DOM con textContent (nunca innerHTML con datos), así un
// nombre de archivo malicioso no puede inyectar código.

const $ = (sel) => document.querySelector(sel);
let usuario = null;
let refresco = null;

// ---------- utilidades ----------
function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of hijos.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(ruta, opciones = {}) {
  const o = { credentials: 'same-origin', ...opciones };
  if (o.json !== undefined) {
    o.method = o.method || 'POST';
    o.headers = { 'Content-Type': 'application/json' };
    o.body = JSON.stringify(o.json);
    delete o.json;
  }
  const r = await fetch(ruta, o);
  let datos = null;
  try { datos = await r.json(); } catch { /* sin cuerpo */ }
  if (r.status === 401 && ruta !== '/api/auth/login') { mostrarLogin(); }
  if (!r.ok) {
    const e = new Error((datos && datos.error) || `Error ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return datos;
}

function aviso(texto, malo = false) {
  const a = $('#aviso');
  a.textContent = texto;
  a.className = malo ? 'aviso mal' : 'aviso';
  a.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => { a.hidden = true; }, 4500);
}
const fallo = (e) => aviso(`${e.status ? `[${e.status}] ` : ''}${e.message}`, true);

const fecha = (s) => (s ? new Date(s).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const kb = (n) => (n == null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
const etq = (txt, clase = txt) => h('span', { class: `etq ${clase}` }, txt);

function tabla(columnas, filas) {
  return h('div', { class: 'tabla' },
    h('table', {},
      h('thead', {}, h('tr', {}, columnas.map((c) => h('th', {}, c)))),
      h('tbody', {}, filas.length ? filas : h('tr', {}, h('td', { colspan: columnas.length, class: 'suave' }, 'Sin datos')))));
}

function dialogo(titulo, ...contenido) {
  $('#dialogo-titulo').textContent = titulo;
  $('#dialogo-cuerpo').replaceChildren(...contenido);
  $('#dialogo').showModal();
}

function datetimeLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- sesión ----------
function mostrarLogin() {
  usuario = null;
  clearInterval(refresco);
  $('#vista-app').hidden = true;
  $('#sesion').hidden = true;
  $('#vista-login').hidden = false;
}

const PESTANAS = {
  estudiante: [['Mis cursos', vistaCursosEstudiante], ['Mis entregas', vistaEntregas]],
  docente: [['Mis cursos', vistaCursosDocente], ['Entregas del curso', vistaEntregas]],
  admin: [['Usuarios', vistaUsuarios], ['Cursos', vistaCursosAdmin], ['Entregas (metadatos)', vistaEntregas],
    ['Auditoría', vistaAuditoria], ['Estado', vistaEstado]],
};

function mostrarApp() {
  $('#vista-login').hidden = true;
  $('#vista-app').hidden = false;
  $('#sesion').hidden = false;
  $('#quien').textContent = `${usuario.nombre} (${usuario.username} · ${usuario.rol})`;
  const nav = $('#pestanas');
  nav.replaceChildren();
  PESTANAS[usuario.rol].forEach(([nombre, fn], i) => {
    const b = h('button', { onclick: () => abrir(b, fn) }, nombre);
    nav.append(b);
    if (i === 0) abrir(b, fn);
  });
}

function abrir(boton, fn) {
  clearInterval(refresco);
  document.querySelectorAll('#pestanas button').forEach((b) => b.classList.toggle('activa', b === boton));
  const cont = $('#contenido');
  cont.replaceChildren(h('p', { class: 'suave' }, 'Cargando…'));
  fn(cont).catch(fallo);
}

$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const err = $('#login-error');
  err.hidden = true;
  try {
    const r = await api('/api/auth/login', { json: { username: f.get('username'), password: f.get('password') } });
    usuario = r.user;
    ev.target.reset();
    mostrarApp();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
});

$('#salir').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  mostrarLogin();
});
$('#dialogo-cerrar').addEventListener('click', () => $('#dialogo').close());

// ---------- detalle de una entrega ----------
async function verResultado(id) {
  try {
    const r = await api(`/api/entregas/${id}/resultado`);
    const resumen = h('div', { class: 'cuadricula' },
      [['Líneas', r.lineas], ['Palabras', r.palabras], ['Caracteres', r.caracteres], ['Tiempo (ms)', r.tiempo_procesamiento_ms]]
        .map(([k, v]) => h('div', { class: 'dato' }, k, h('b', {}, v))));
    const dup = r.posible_duplicado === undefined ? null
      : h('p', {}, r.posible_duplicado
        ? etq(`Posible duplicado de: ${r.duplicado_con.map((d) => d.estudiante).join(', ')}`, 'dup')
        : etq('Sin duplicados en la actividad', 'completado'));
    dialogo(`Resultado · ${r.archivo}`, dup || '', h('p', { class: 'mono' }, `SHA-256: ${r.sha256}`), resumen,
      h('h3', {}, 'Resultado completo (JSON)'), h('pre', {}, JSON.stringify(r, null, 2)));
  } catch (e) { fallo(e); }
}

async function verTrazabilidad(id) {
  try {
    const r = await api(`/api/entregas/${id}/trazabilidad`);
    dialogo(`Trazabilidad · ${r.entrega.nombre_original}`,
      h('p', { class: 'suave' }, `${r.entrega.curso} · ${r.entrega.actividad} · ${r.entrega.estudiante}`),
      tabla(['Fecha', 'Usuario', 'Acción', 'Resultado', 'IP', 'Detalle'], r.eventos.map((ev) => h('tr', {},
        h('td', {}, fecha(ev.ts)), h('td', {}, `${ev.username || '—'} (${ev.rol})`), h('td', {}, ev.accion),
        h('td', {}, etq(ev.resultado)), h('td', {}, ev.ip || '—'),
        h('td', { class: 'mono' }, JSON.stringify(ev.detalle))))));
  } catch (e) { fallo(e); }
}

function selectorArchivo(texto, alElegir) {
  const input = h('input', { type: 'file', accept: '.txt,.md,.csv,.json', hidden: true });
  input.addEventListener('change', () => { if (input.files[0]) alElegir(input.files[0]); input.value = ''; });
  return [input, h('button', { class: 'mini sec', onclick: () => input.click() }, texto)];
}

async function enviarArchivo(ruta, metodo, archivo) {
  const fd = new FormData();
  fd.append('archivo', archivo);
  return api(ruta, { method: metodo, body: fd });
}

// ---------- vista común: listado de entregas ----------
async function vistaEntregas(cont) {
  const pintar = async () => {
    const filas = await api('/api/entregas');
    const rol = usuario.rol;
    const cols = ['Curso', 'Actividad', ...(rol !== 'estudiante' ? ['Estudiante'] : []), 'Archivo', 'Tamaño', 'Estado', 'Subida', 'Acciones'];
    const cuerpo = filas.map((e) => {
      const acc = [];
      if (rol !== 'admin') {
        if (e.estado === 'completado') acc.push(h('button', { class: 'mini', onclick: () => verResultado(e.id) }, 'Resultado'));
        acc.push(h('a', { href: `/api/entregas/${e.id}/archivo` }, h('button', { class: 'mini sec' }, 'Descargar')));
      }
      if (rol !== 'estudiante') acc.push(h('button', { class: 'mini sec', onclick: () => verTrazabilidad(e.id) }, 'Trazabilidad'));
      if (rol !== 'estudiante' && e.estado === 'fallido') {
        acc.push(h('button', { class: 'mini', onclick: () => api(`/api/entregas/${e.id}/reprocesar`, { method: 'POST' }).then(() => { aviso('Reencolado'); pintar(); }).catch(fallo) }, 'Reprocesar'));
      }
      if (rol === 'estudiante') {
        acc.push(...selectorArchivo('Reemplazar', (f) => enviarArchivo(`/api/entregas/${e.id}`, 'PUT', f)
          .then(() => { aviso('Entrega reemplazada'); pintar(); }).catch(fallo)));
        acc.push(h('button', { class: 'mini peligro', onclick: () => {
          if (!window.confirm(`¿Eliminar ${e.nombre_original}?`)) return;
          api(`/api/entregas/${e.id}`, { method: 'DELETE' }).then(() => { aviso('Entrega eliminada'); pintar(); }).catch(fallo);
        } }, 'Eliminar'));
      }
      return h('tr', {},
        h('td', {}, e.curso), h('td', {}, e.actividad),
        rol !== 'estudiante' ? h('td', {}, e.estudiante) : null,
        h('td', {}, e.nombre_original, e.posible_duplicado ? [' ', etq('posible duplicado', 'dup')] : null),
        h('td', {}, kb(e.tamano)),
        h('td', {}, etq(e.estado || '—'), e.error ? h('div', { class: 'suave' }, e.error) : null),
        h('td', {}, fecha(e.creado_en)),
        h('td', { class: 'acciones' }, acc));
    });
    const titulo = rol === 'admin' ? 'Entregas (solo metadatos: el Admin TI no ve contenidos)' : rol === 'docente' ? 'Entregas de mis cursos' : 'Mis entregas';
    cont.replaceChildren(h('div', { class: 'tarjeta' },
      h('div', { class: 'fila' }, h('h2', {}, titulo), h('button', { class: 'sec mini', onclick: () => pintar().catch(fallo) }, 'Actualizar')),
      tabla(cols, cuerpo)));
    return filas.some((e) => e.estado === 'pendiente' || e.estado === 'en_ejecucion');
  };
  const hayPendientes = await pintar();
  clearInterval(refresco);
  if (hayPendientes || usuario.rol !== 'admin') refresco = setInterval(() => pintar().catch(() => {}), 4000);
}

// ---------- estudiante ----------
async function vistaCursosEstudiante(cont) {
  const cursos = await api('/api/cursos');
  const tarjetas = await Promise.all(cursos.map(async (c) => {
    const acts = await api(`/api/cursos/${c.id}/actividades`);
    return h('div', { class: 'tarjeta' },
      h('h2', {}, `${c.codigo} · ${c.nombre}`), h('p', { class: 'suave' }, `Docente: ${c.docente_nombre}`),
      acts.length ? acts.map((a) => h('div', { class: 'actividad' },
        h('h3', {}, a.titulo, ' ', etq(a.abierta ? 'abierta' : 'cerrada')),
        a.descripcion ? h('p', {}, a.descripcion) : null,
        h('p', { class: 'suave' }, `Cierra: ${fecha(a.limite_efectivo)}`, a.prorroga ? ` (con prórroga; original ${fecha(a.fecha_limite)})` : '',
          ` · Mis entregas: ${a.entregas}`),
        selectorArchivo('Subir archivo (.txt .md .csv .json, máx. 5 MB)', (f) => enviarArchivo(`/api/actividades/${a.id}/entregas`, 'POST', f)
          .then((r) => { aviso(`Entrega recibida (${r.nombre}). Estado: pendiente`); abrir($('#pestanas button'), vistaCursosEstudiante); })
          .catch(fallo)))) : h('p', { class: 'suave' }, 'Sin actividades'));
  }));
  cont.replaceChildren(...(tarjetas.length ? tarjetas : [h('p', {}, 'No estás matriculado en ningún curso.')]));
}

// ---------- docente ----------
async function vistaCursosDocente(cont) {
  const cursos = await api('/api/cursos');
  const tarjetas = await Promise.all(cursos.map(async (c) => {
    const [acts, ests] = await Promise.all([api(`/api/cursos/${c.id}/actividades`), api(`/api/cursos/${c.id}/estudiantes`)]);
    const fTitulo = h('input', { placeholder: 'Título', required: true });
    const fDesc = h('input', { placeholder: 'Descripción (opcional)' });
    const fFecha = h('input', { type: 'datetime-local', value: datetimeLocal(new Date(Date.now() + 7 * 864e5)) });
    const crear = (limite) => api(`/api/cursos/${c.id}/actividades`, { json: { titulo: fTitulo.value, descripcion: fDesc.value, fecha_limite: limite } })
      .then(() => { aviso('Actividad creada'); abrir($('#pestanas button'), vistaCursosDocente); }).catch(fallo);

    return h('div', { class: 'tarjeta' },
      h('h2', {}, `${c.codigo} · ${c.nombre}`),
      h('p', { class: 'suave' }, `Estudiantes: ${ests.map((e) => e.username).join(', ') || 'ninguno'}`),
      acts.map((a) => {
        const sel = h('select', {}, ests.map((e) => h('option', { value: e.username }, `${e.nombre} (${e.username})`)));
        const nf = h('input', { type: 'datetime-local', value: datetimeLocal(new Date(Date.now() + 2 * 864e5)) });
        return h('div', { class: 'actividad' },
          h('h3', {}, a.titulo, ' ', etq(a.abierta ? 'abierta' : 'cerrada')),
          h('p', { class: 'suave' }, `Cierra: ${fecha(a.fecha_limite)} · Entregas: ${a.entregas}`),
          h('div', { class: 'fila' },
            h('label', {}, 'Prórroga para', sel), h('label', {}, 'Nueva fecha límite', nf),
            h('button', { onclick: () => api(`/api/actividades/${a.id}/prorrogas`, { json: { estudiante: sel.value, nueva_fecha_limite: new Date(nf.value).toISOString() } })
              .then((r) => aviso(`Prórroga otorgada a ${r.estudiante}`)).catch(fallo) }, 'Otorgar prórroga')));
      }),
      h('h3', {}, 'Nueva actividad'),
      h('div', { class: 'fila' }, h('label', {}, 'Título', fTitulo), h('label', {}, 'Descripción', fDesc), h('label', {}, 'Fecha límite', fFecha)),
      h('div', { class: 'fila' },
        h('button', { onclick: () => crear(new Date(fFecha.value).toISOString()) }, 'Crear actividad'),
        h('button', { class: 'sec', onclick: () => crear(new Date(Date.now() + 60000).toISOString()) }, 'Crear (cierra en 1 minuto · demo RN-1)')));
  }));
  cont.replaceChildren(...(tarjetas.length ? tarjetas : [h('p', {}, 'No dictas ningún curso.')]));
}

// ---------- admin ----------
async function vistaUsuarios(cont) {
  const lista = await api('/api/admin/usuarios');
  const f = { username: h('input', { placeholder: 'ej. est_prueba' }), nombre: h('input'), password: h('input', { type: 'password', placeholder: 'mín. 10 caracteres' }),
    rol: h('select', {}, ['estudiante', 'docente', 'admin'].map((r) => h('option', { value: r }, r))) };
  cont.replaceChildren(
    h('div', { class: 'tarjeta' }, h('h2', {}, 'Crear usuario'),
      h('div', { class: 'fila' }, h('label', {}, 'Usuario', f.username), h('label', {}, 'Nombre', f.nombre), h('label', {}, 'Contraseña', f.password), h('label', {}, 'Rol', f.rol),
        h('button', { onclick: () => api('/api/admin/usuarios', { json: { username: f.username.value, nombre: f.nombre.value, password: f.password.value, rol: f.rol.value } })
          .then(() => { aviso('Usuario creado'); vistaUsuarios(cont); }).catch(fallo) }, 'Crear'))),
    h('div', { class: 'tarjeta' }, h('h2', {}, 'Usuarios'),
      tabla(['Usuario', 'Nombre', 'Rol', 'Estado', 'Creado', 'Acciones'], lista.map((u) => h('tr', {},
        h('td', {}, u.username), h('td', {}, u.nombre), h('td', {}, u.rol), h('td', {}, etq(u.activo ? 'activo' : 'inactivo', u.activo ? 'completado' : 'fallido')),
        h('td', {}, fecha(u.creado_en)),
        h('td', { class: 'acciones' }, u.id === usuario.id ? h('span', { class: 'suave' }, '(tú)')
          : h('button', { class: `mini ${u.activo ? 'peligro' : ''}`, onclick: () => api(`/api/admin/usuarios/${u.id}`, { method: 'PATCH', json: { activo: !u.activo } })
            .then(() => vistaUsuarios(cont)).catch(fallo) }, u.activo ? 'Desactivar' : 'Activar')))))));
}

async function vistaCursosAdmin(cont) {
  const [cursos, docentes, estudiantes] = await Promise.all([api('/api/cursos'), api('/api/admin/usuarios?rol=docente'), api('/api/admin/usuarios?rol=estudiante')]);
  const cod = h('input', { placeholder: 'ej. RED-301' });
  const nom = h('input');
  const doc = h('select', {}, docentes.map((d) => h('option', { value: d.username }, `${d.nombre} (${d.username})`)));
  cont.replaceChildren(
    h('div', { class: 'tarjeta' }, h('h2', {}, 'Crear curso'),
      h('div', { class: 'fila' }, h('label', {}, 'Código', cod), h('label', {}, 'Nombre', nom), h('label', {}, 'Docente', doc),
        h('button', { onclick: () => api('/api/admin/cursos', { json: { codigo: cod.value, nombre: nom.value, docente: doc.value } })
          .then(() => { aviso('Curso creado'); vistaCursosAdmin(cont); }).catch(fallo) }, 'Crear'))),
    h('div', { class: 'tarjeta' }, h('h2', {}, 'Cursos'),
      tabla(['Código', 'Nombre', 'Docente', 'Matriculados', 'Actividades', 'Matricular'], cursos.map((c) => {
        const sel = h('select', {}, estudiantes.map((e) => h('option', { value: e.username }, e.username)));
        return h('tr', {}, h('td', {}, c.codigo), h('td', {}, c.nombre), h('td', {}, c.docente), h('td', {}, c.matriculados), h('td', {}, c.actividades),
          h('td', { class: 'acciones' }, h('div', { class: 'fila' }, sel,
            h('button', { class: 'mini', onclick: () => api(`/api/admin/cursos/${c.id}/matriculas`, { json: { estudiante: sel.value } })
              .then((r) => { aviso(`${r.estudiante} matriculado en ${r.curso}`); vistaCursosAdmin(cont); }).catch(fallo) }, 'Matricular'))));
      }))));
}

async function vistaAuditoria(cont) {
  const filtroRes = h('select', {}, ['', 'PERMITIDO', 'DENEGADO', 'ERROR'].map((r) => h('option', { value: r }, r || 'Todos')));
  const filtroUsr = h('input', { placeholder: 'usuario (opcional)' });
  const zona = h('div');
  const cargar = async () => {
    const q = new URLSearchParams({ limit: '200' });
    if (filtroRes.value) q.set('resultado', filtroRes.value);
    if (filtroUsr.value.trim()) q.set('usuario', filtroUsr.value.trim());
    const [eventos, denegados] = await Promise.all([api(`/api/admin/auditoria?${q}`), api('/api/admin/auditoria/denegados')]);
    zona.replaceChildren(
      h('div', { class: 'tarjeta' }, h('h2', {}, 'Accesos denegados por usuario'),
        tabla(['Usuario', 'Rol', 'Intentos', 'Recursos distintos', 'Motivos', 'Último'], denegados.map((d) => h('tr', {},
          h('td', {}, d.username), h('td', {}, d.rol), h('td', {}, d.intentos), h('td', {}, d.recursos_distintos),
          h('td', {}, (d.motivos || []).filter(Boolean).join(', ')), h('td', {}, fecha(d.ultimo)))))),
      h('div', { class: 'tarjeta' }, h('h2', {}, `Registro de auditoría (${eventos.length})`),
        tabla(['Fecha', 'Usuario', 'Acción', 'Recurso', 'Resultado', 'IP', 'Detalle'], eventos.map((ev) => h('tr', {},
          h('td', {}, fecha(ev.ts)), h('td', {}, `${ev.username || '—'} (${ev.rol})`), h('td', {}, ev.accion),
          h('td', { class: 'mono' }, ev.recurso_tipo ? `${ev.recurso_tipo}:${ev.recurso_id}` : '—'),
          h('td', {}, etq(ev.resultado)), h('td', {}, ev.ip || '—'), h('td', { class: 'mono' }, JSON.stringify(ev.detalle)))))));
  };
  cont.replaceChildren(h('div', { class: 'tarjeta' }, h('div', { class: 'fila' },
    h('label', {}, 'Resultado', filtroRes), h('label', {}, 'Usuario', filtroUsr), h('button', { onclick: () => cargar().catch(fallo) }, 'Filtrar'))), zona);
  await cargar();
}

async function vistaEstado(cont) {
  const pintar = async () => {
    const e = await api('/api/admin/estado');
    const dato = (k, v) => h('div', { class: 'dato' }, k, h('b', {}, v ?? '—'));
    cont.replaceChildren(
      h('div', { class: 'tarjeta' }, h('h2', {}, 'Servicios'), h('div', { class: 'cuadricula' },
        Object.entries(e.servicios).map(([k, v]) => h('div', { class: 'dato' }, k, h('b', {}, etq(v, v === 'ok' ? 'completado' : 'fallido')))))),
      h('div', { class: 'tarjeta' }, h('h2', {}, 'Cola de trabajos'), h('div', { class: 'cuadricula' },
        dato('Pendientes', e.cola.pendiente), dato('En ejecución', e.cola.en_ejecucion), dato('Completados', e.cola.completado), dato('Fallidos', e.cola.fallido),
        dato('Tiempo medio (ms)', e.procesamiento.ms_promedio), dato('Tiempo máximo (ms)', e.procesamiento.ms_max),
        dato('Pendiente más antiguo (s)', e.pendiente_mas_antiguo_seg)),
      e.ultimo_error ? h('p', {}, 'Último error: ', h('span', { class: 'error' }, e.ultimo_error.error), ` (${fecha(e.ultimo_error.terminado_en)})`) : null),
      h('div', { class: 'tarjeta' }, h('h2', {}, 'Recursos'), h('div', { class: 'cuadricula' },
        dato('Disco de datos libre (MB)', e.disco_datos && e.disco_datos.libre_mb), dato('Disco de datos total (MB)', e.disco_datos && e.disco_datos.total_mb),
        dato('Memoria de la API (MB)', e.memoria_api_mb), dato('API activa (s)', e.uptime_api_seg),
        dato('Eventos de auditoría', e.auditoria.total), dato('Denegados 24 h', e.auditoria.denegados_24h))));
  };
  await pintar();
  refresco = setInterval(() => pintar().catch(() => {}), 5000);
}

// ---------- arranque ----------
api('/api/auth/me').then((r) => { usuario = r.user; mostrarApp(); }).catch(() => mostrarLogin());
