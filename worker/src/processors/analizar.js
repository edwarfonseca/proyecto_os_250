'use strict';
// =====================================================================
// PROCESADOR · análisis de una entrega de texto
//   - valida que el contenido sea UTF-8 válido (capa 3 de validación)
//   - SHA-256, líneas, palabras, caracteres, top 10 de palabras
//   - CSV: filas y columnas · JSON: si es válido y su tipo
// Es determinista: el mismo archivo produce siempre el mismo resultado.
// =====================================================================
const crypto = require('node:crypto');
const path = require('node:path');

class ErrorPermanente extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.permanente = true; // no tiene sentido reintentar
  }
}

const VACIAS = new Set(`a al algo como con de del el ella ellos en entre era es esa ese eso esta este
esto fue ha han hay la las le les lo los mas me mi muy no nos o para pero por que se ser si sin
sobre son su sus también te tiene un una uno unos y ya the and of to in is it for on with as`.split(/\s+/));

function contarPalabras(texto) {
  const palabras = texto.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
  const freq = new Map();
  for (const p of palabras) {
    if (p.length < 3 || VACIAS.has(p) || /^\d+$/.test(p)) continue;
    freq.set(p, (freq.get(p) || 0) + 1);
  }
  const top = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([palabra, veces]) => ({ palabra, veces }));
  return { total: palabras.length, top };
}

// CSV sencillo: detecta el separador (, o ;) en la cabecera y respeta comillas.
function analizarCsv(texto) {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lineas.length) return { filas: 0, columnas: 0 };
  const sep = (lineas[0].match(/;/g) || []).length > (lineas[0].match(/,/g) || []).length ? ';' : ',';
  const contarCampos = (l) => {
    let n = 1;
    let enComillas = false;
    for (const ch of l) {
      if (ch === '"') enComillas = !enComillas;
      else if (ch === sep && !enComillas) n += 1;
    }
    return n;
  };
  const columnas = contarCampos(lineas[0]);
  const irregulares = lineas.filter((l) => contarCampos(l) !== columnas).length;
  return {
    separador: sep,
    filas: lineas.length - 1, // sin la cabecera
    columnas,
    cabecera: lineas[0].split(sep).map((c) => c.replace(/^"|"$/g, '').trim()).slice(0, 30),
    filas_irregulares: irregulares,
  };
}

function analizarJson(texto) {
  try {
    const v = JSON.parse(texto);
    const tipo = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
    return {
      json_valido: true,
      tipo_raiz: tipo,
      elementos: Array.isArray(v) ? v.length : tipo === 'object' ? Object.keys(v).length : null,
    };
  } catch (e) {
    return { json_valido: false, error_json: e.message.slice(0, 200) };
  }
}

function analizar(buffer, nombreOriginal) {
  const t0 = process.hrtime.bigint();
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  let texto;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new ErrorPermanente('El archivo no es texto UTF-8 válido (¿binario disfrazado?)');
  }
  if (texto.includes('\u0000')) {
    throw new ErrorPermanente('El archivo contiene bytes nulos: no es un archivo de texto');
  }

  const ext = path.extname(nombreOriginal || '').toLowerCase();
  const lineas = texto === '' ? 0 : texto.split(/\r?\n/).length - (texto.endsWith('\n') ? 1 : 0);
  const palabras = contarPalabras(texto);

  const resultado = {
    sha256,
    bytes: buffer.length,
    lineas,
    palabras: palabras.total,
    caracteres: [...texto].length,
    top_palabras: palabras.top,
  };
  if (ext === '.csv') resultado.csv = analizarCsv(texto);
  if (ext === '.json') resultado.json = analizarJson(texto);
  resultado.ms_analisis = Number(process.hrtime.bigint() - t0) / 1e6;
  return resultado;
}

module.exports = { analizar, ErrorPermanente };
