// ============ CONFIGURACIÓN ============
const SUPABASE_URL = 'https://jmrtjgwzsivuwievethn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_b0r2d5pfQpZrfDz_SLxm1g_UjDDjKh4';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ============ ESTADO ============
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

// Sello anónimo de este navegador: sirve para saber qué mensajes son "tuyos"
function obtenerToken() {
  try {
    let t = localStorage.getItem('token_foro');
    if (!t) {
      t = crypto.randomUUID();
      localStorage.setItem('token_foro', t);
    }
    return t;
  } catch (e) {
    return crypto.randomUUID(); // si el navegador bloquea el almacenamiento, vale solo para esta visita
  }
}
const token = obtenerToken();

let codigo = sessionStorage.getItem('codigo_foro'); // se borra al cerrar la pestaña
let rol = null;               // 'admin', 'amigo' o null (lo confirma el servidor)
let apertura = 0;             // momento de apertura (ms)
let offset = 0;               // diferencia entre el reloj del servidor y el de este dispositivo
let foroAbierto = false;
let vistaVania = false;       // true = el admin está previsualizando lo que verá Vania
let bienvenidaVista = false;
let mensajes = [];
let firmaAnterior = '';
let editandoId = null;
let fotoActual = null;

const ahoraServidor = () => Date.now() + offset;
const verForo = () => foroAbierto || Boolean(codigo);
const esAmigo = () => Boolean(codigo) && !vistaVania;  // modo edición activo (amigo o admin)
const esAdmin = () => rol === 'admin';

// ============ ARRANQUE ============
async function iniciar() {
  const info = await cargarInfo();
  if (!info) {
    $('estado-conexion').textContent = 'No se pudo conectar. Recarga la página.';
    return;
  }
  offset = new Date(info.ahora).getTime() - Date.now();
  apertura = new Date(info.apertura).getTime();

  if (codigo) {
    rol = await obtenerRol(codigo);
    if (!rol) salirModoAmigos();
  }

  foroAbierto = apertura - ahoraServidor() <= 0;
  actualizarPantallas();
  tick();
  setInterval(tick, 1000);       // el contador
  setInterval(refrescar, 20000); // mensajes nuevos
}

async function cargarInfo() {
  const { data, error } = await db.rpc('info_foro');
  if (error || !data || !data.length) return null;
  return data[0];
}

// ============ CONTADOR ============
function tick() {
  const falta = apertura - ahoraServidor();
  const abierto = falta <= 0;
  if (abierto !== foroAbierto) {
    foroAbierto = abierto;
    actualizarPantallas();
  }
  const s = Math.max(0, Math.floor(falta / 1000));
  $('r-dias').textContent = Math.floor(s / 86400);
  $('r-horas').textContent = pad(Math.floor((s % 86400) / 3600));
  $('r-min').textContent = pad(Math.floor((s % 3600) / 60));
  $('r-seg').textContent = pad(s % 60);

  if (esAmigo() && !foroAbierto) {
    $('banner-amigos').textContent =
      `🔒 Modo amigos: Vania aún no puede ver esto. Se abre al público en ` +
      `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m ${pad(s % 60)}s`;
  }
}

// ============ PANTALLAS ============
function actualizarPantallas() {
  const ver = verForo();
  const amigo = esAmigo();
  document.body.classList.toggle('con-pestanas', esAdmin());
  $('pantalla-cuenta').classList.toggle('oculto', ver);
  $('pantalla-foro').classList.toggle('oculto', !ver);
  $('form-mensaje').classList.toggle('oculto', !amigo);
  $('banner-amigos').classList.toggle('oculto', !amigo || foroAbierto);
  $('btn-amigo').classList.toggle('oculto', Boolean(codigo));
  $('btn-salir').classList.toggle('oculto', !codigo);
  $('pestanas').classList.toggle('oculto', !esAdmin());   // solo el admin ve las pestañas
  $('tab-amigos').classList.toggle('activa', !vistaVania);
  $('tab-vania').classList.toggle('activa', vistaVania);
  $('bienvenida').classList.toggle('oculto', !((foroAbierto || vistaVania) && !amigo && !bienvenidaVista));
  $('btn-musica').classList.toggle('oculto', !ver);
  if (!ver) cerrarVisor();
  if (ver) {
    cargar();
    if (foroAbierto) setTimeout(cargar, 2000); // reintento por si el servidor va unos ms atrasado
  }
}

async function refrescar() {
  if (verForo()) await cargar();
}

// ============ MENSAJES ============
async function cargar() {
  const { data, error } = await db.rpc('leer_mensajes', { p_codigo: codigo, p_token: token });
  if (error) return;
  const lista = data || [];
  const firma = (esAmigo() ? 'A' + rol : 'P') +
    JSON.stringify(lista.map((m) => [m.id, m.autor, m.texto, m.foto_url, m.mio]));
  if (firma === firmaAnterior) return; // nada cambió, no redibujamos
  firmaAnterior = firma;
  mensajes = lista;
  renderMuro();
}

function el(tag, clase) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  return e;
}

function renderMuro() {
  $('muro').replaceChildren(...mensajes.map((m) => crearTarjeta(m)));
  $('vacio').classList.toggle('oculto', mensajes.length > 0);
}

function crearTarjeta(m, soloLectura = false) {
  const card = el('article', 'tarjeta');
  if (m.foto_url) {
    const img = el('img');
    img.src = m.foto_url;
    img.alt = 'Foto de ' + m.autor;
    img.loading = 'lazy';
    img.addEventListener('click', () => abrirFoto(m.foto_url));
    card.append(img);
  }
  const texto = el('p', 'texto');
  texto.textContent = m.texto;      // textContent: el texto nunca se interpreta como HTML
  const autor = el('p', 'autor');
  autor.textContent = '— ' + m.autor;
  card.append(texto, autor);

  // El admin ve Editar/Borrar en todos; el amigo, solo en los suyos
  if (esAmigo() && !soloLectura && (esAdmin() || m.mio)) {
    const acc = el('div', 'acciones');
    const bEditar = el('button', 'secundario');
    bEditar.textContent = 'Editar';
    bEditar.addEventListener('click', () => empezarEdicion(m));
    const bBorrar = el('button', 'secundario');
    bBorrar.textContent = 'Borrar';
    bBorrar.addEventListener('click', () => borrar(m));
    acc.append(bEditar, bBorrar);
    card.append(acc);
  }
  return card;
}

// ============ FORMULARIO ============
async function comprimir(archivo, maxLado = 1280, calidad = 0.82) {
  const bmp = await createImageBitmap(archivo);
  const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * escala);
  canvas.height = Math.round(bmp.height * escala);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, fallo) =>
    canvas.toBlob((b) => (b ? ok(b) : fallo(new Error('No se pudo procesar la foto'))), 'image/jpeg', calidad)
  );
}

async function subirFoto(archivo) {
  const blob = await comprimir(archivo);
  const nombre = `${crypto.randomUUID()}.jpg`;
  const { error } = await db.storage.from('fotos').upload(nombre, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return db.storage.from('fotos').getPublicUrl(nombre).data.publicUrl;
}

$('campo-foto').addEventListener('change', () => {
  const f = $('campo-foto').files[0];
  const img = $('vista-previa');
  if (f) {
    img.src = URL.createObjectURL(f);
    img.classList.remove('oculto');
  } else {
    img.classList.add('oculto');
  }
});

function limpiarForm() {
  editandoId = null;
  fotoActual = null;
  $('form-mensaje').reset();
  $('vista-previa').classList.add('oculto');
  $('fila-quitar').classList.add('oculto');
  $('btn-cancelar').classList.add('oculto');
  $('btn-publicar').textContent = 'Publicar';
  $('titulo-form').textContent = 'Escribe tu mensaje';
}

$('form-mensaje').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-publicar');
  btn.disabled = true;
  $('estado-form').textContent = 'Enviando…';
  try {
    const archivo = $('campo-foto').files[0];
    let fotoUrl = $('chk-quitar').checked ? null : fotoActual;
    if (archivo) fotoUrl = await subirFoto(archivo);

    const base = {
      p_codigo: codigo,
      p_token: token,
      p_autor: $('campo-autor').value,
      p_texto: $('campo-texto').value,
      p_foto_url: fotoUrl,
    };
    const { error } = editandoId
      ? await db.rpc('editar_mensaje', { ...base, p_id: editandoId })
      : await db.rpc('crear_mensaje', base);
    if (error) throw error;

    limpiarForm();
    await cargar();
    $('estado-form').textContent = 'Listo ✅';
    setTimeout(() => ($('estado-form').textContent = ''), 3000);
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.includes('codigo_invalido')) {
      salirModoAmigos();
      alert('El código ya no es válido.');
    } else if (msg.includes('sin_permiso')) {
      $('estado-form').textContent = 'Solo puedes editar tus propios mensajes.';
    } else {
      $('estado-form').textContent = 'Error: ' + msg;
    }
  } finally {
    btn.disabled = false;
  }
});

function empezarEdicion(m) {
  limpiarForm();
  editandoId = m.id;
  fotoActual = m.foto_url || null;
  $('campo-autor').value = m.autor;
  $('campo-texto').value = m.texto;
  $('fila-quitar').classList.toggle('oculto', !m.foto_url);
  $('btn-cancelar').classList.remove('oculto');
  $('btn-publicar').textContent = 'Guardar cambios';
  $('titulo-form').textContent = 'Editando mensaje';
  $('form-mensaje').scrollIntoView({ behavior: 'smooth' });
}

$('btn-cancelar').addEventListener('click', () => {
  limpiarForm();
  $('estado-form').textContent = '';
});

async function borrar(m) {
  if (!confirm(`¿Borrar el mensaje de ${m.autor}?`)) return;
  const { error } = await db.rpc('borrar_mensaje', { p_codigo: codigo, p_token: token, p_id: m.id });
  if (error) {
    alert(String(error.message).includes('sin_permiso')
      ? 'Solo puedes borrar tus propios mensajes.'
      : 'No se pudo borrar.');
    return;
  }
  await cargar();
}

// ============ MODO AMIGOS (CÓDIGO) ============
async function obtenerRol(cod) {
  const { data, error } = await db.rpc('obtener_rol', { p_codigo: cod });
  return error ? null : data; // 'admin', 'amigo' o null
}

$('btn-amigo').addEventListener('click', () => {
  $('input-codigo').value = '';
  $('error-codigo').textContent = '';
  $('dlg-codigo').showModal();
});
$('btn-cerrar-codigo').addEventListener('click', () => $('dlg-codigo').close());

$('form-codigo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const c = $('input-codigo').value.trim();
  if (!c) return;
  const r = await obtenerRol(c);
  if (!r) {
    $('error-codigo').textContent = 'Código incorrecto';
    return;
  }
  codigo = c;
  rol = r;
  vistaVania = false;
  sessionStorage.setItem('codigo_foro', c);
  firmaAnterior = '';
  $('dlg-codigo').close();
  actualizarPantallas();
});

function salirModoAmigos() {
  codigo = null;
  rol = null;
  vistaVania = false;
  sessionStorage.removeItem('codigo_foro');
  limpiarForm();
  firmaAnterior = '';
  actualizarPantallas();
}
$('btn-salir').addEventListener('click', salirModoAmigos);

// ============ FOTO EN GRANDE ============
function abrirFoto(url) {
  $('foto-grande').src = url;
  $('dlg-foto').showModal();
}
$('dlg-foto').addEventListener('click', () => $('dlg-foto').close());

// ============ MÚSICA Y BIENVENIDA ============
const TEXTO_FINAL = 'Eso fue todo… por ahora 💜\nFeliz cumpleaños, Vania 🎂';
let musicaActiva = false;
const musica = $('musica');
musica.volume = 0.4;

function actualizarBotonMusica() {
  $('btn-musica').textContent = musicaActiva ? '🎵' : '🔇';
  $('btn-musica').classList.toggle('apagada', !musicaActiva);
}

$('btn-musica').addEventListener('click', async () => {
  try {
    if (musicaActiva) { musica.pause(); musicaActiva = false; }
    else { await musica.play(); musicaActiva = true; }
  } catch (e) { /* el navegador la bloqueó o falta musica.mp3 */ }
  actualizarBotonMusica();
});

$('btn-abrir-regalo').addEventListener('click', async () => {
  bienvenidaVista = true;
  $('bienvenida').classList.add('oculto');
  try { await musica.play(); musicaActiva = true; } catch (e) {}
  actualizarBotonMusica();
});

// ============ PESTAÑAS (VISTA DE VANIA, SOLO ADMIN) ============
function cambiarVista(paraVania) {
  if (paraVania && !esAdmin()) return;
  vistaVania = paraVania;
  bienvenidaVista = false;          // vuelve a mostrarse la pantalla del regalo
  if (!paraVania && musicaActiva) { // al volver al modo amigos se detiene la música
    musica.pause();
    musicaActiva = false;
    actualizarBotonMusica();
  }
  cerrarVisor();
  firmaAnterior = '';
  actualizarPantallas();
}
$('tab-amigos').addEventListener('click', () => cambiarVista(false));
$('tab-vania').addEventListener('click', () => cambiarVista(true));

// ============ MODO UNO POR UNO ============
let diapos = [];
let posicion = 0;

function abrirVisor() {
  if (!mensajes.length) return;
  diapos = [...mensajes].reverse(); // del más antiguo al más nuevo
  posicion = 0;
  $('visor').classList.remove('oculto');
  document.body.style.overflow = 'hidden';
  mostrarDiapo();
}

function cerrarVisor() {
  $('visor').classList.add('oculto');
  document.body.style.overflow = '';
}

function mostrarDiapo() {
  const total = diapos.length;
  const cont = $('visor-contenido');
  if (posicion < total) {
    cont.replaceChildren(crearTarjeta(diapos[posicion], true));
  } else {
    const fin = el('article', 'tarjeta final');
    const t = el('p', 'texto');
    t.textContent = TEXTO_FINAL;
    fin.append(t);
    cont.replaceChildren(fin);
  }
  $('visor-pos').textContent = posicion < total ? `${posicion + 1} / ${total}` : '💜';
  $('visor-ant').disabled = posicion === 0;
  $('visor-sig').disabled = posicion === total;
}

$('btn-uno-a-uno').addEventListener('click', abrirVisor);
$('visor-cerrar').addEventListener('click', cerrarVisor);
$('visor-ant').addEventListener('click', () => { posicion--; mostrarDiapo(); });
$('visor-sig').addEventListener('click', () => { posicion++; mostrarDiapo(); });
document.addEventListener('keydown', (e) => {
  if ($('visor').classList.contains('oculto')) return;
  if (e.key === 'ArrowRight') $('visor-sig').click();
  if (e.key === 'ArrowLeft') $('visor-ant').click();
  if (e.key === 'Escape') cerrarVisor();
});

actualizarBotonMusica();
iniciar();