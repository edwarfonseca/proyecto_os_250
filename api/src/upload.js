'use strict';
// =====================================================================
// Recepción de archivos (capa 2 de validación; la 1 es Nginx y la 3 el worker)
//   - extensión permitida: .txt .md .csv .json
//   - MIME declarado dentro de una lista blanca
//   - tamaño máximo 5 MB
//   - el archivo se guarda como /data/originales/<user_id>/<uuid>.<ext>
//     El nombre que puso el usuario NUNCA se usa como ruta.
// El MIME lo declara el cliente y no es confiable: la verificación real del
// contenido (UTF-8 válido) la hace el worker.
// =====================================================================
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('./config');

const EXTENSIONES = new Set(['.txt', '.md', '.csv', '.json']);
const MIMES = new Set([
  'text/plain', 'text/markdown', 'text/x-markdown', 'text/csv', 'text/x-csv',
  'application/csv', 'application/json', 'application/vnd.ms-excel',
  'application/octet-stream', '',
]);

class ArchivoRechazado extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.code = 'TIPO_NO_PERMITIDO';
  }
}

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const dir = path.join(config.dataDir, 'originales', req.user.id);
    fs.mkdir(dir, { recursive: true, mode: 0o750 }, (err) => cb(err, dir));
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!EXTENSIONES.has(ext)) {
    return cb(new ArchivoRechazado(`Extensión no permitida (${ext || 'sin extensión'}). Solo .txt, .md, .csv o .json`));
  }
  const mime = (file.mimetype || '').split(';')[0].trim().toLowerCase();
  if (!MIMES.has(mime)) {
    return cb(new ArchivoRechazado(`Tipo de archivo no permitido (${mime})`));
  }
  return cb(null, true);
}

const recibirArchivo = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.maxBytes, files: 1, fields: 5, parts: 6 },
}).single('archivo');

// Nombre original "limpio": sin rutas ni caracteres de control, solo para mostrar.
function nombreSeguro(original) {
  const base = path.basename(String(original || 'archivo')).replace(/[\u0000-\u001f\u007f]/g, '');
  return base.slice(0, 255) || 'archivo';
}

// Ruta relativa a /data que se guarda en la BD
function rutaRelativa(absoluta) {
  return path.relative(config.dataDir, absoluta);
}

// Convierte una ruta relativa de la BD en absoluta, verificando que no se
// salga de /data (defensa en profundidad).
function rutaAbsoluta(relativa) {
  const abs = path.resolve(config.dataDir, relativa);
  if (!abs.startsWith(path.resolve(config.dataDir) + path.sep)) {
    throw new Error('Ruta fuera del directorio de datos');
  }
  return abs;
}

function borrarSilencioso(abs) {
  if (abs) fs.unlink(abs, () => {});
}

module.exports = { recibirArchivo, nombreSeguro, rutaRelativa, rutaAbsoluta, borrarSilencioso, ArchivoRechazado };
