'use strict';
// Hash de contraseñas con argon2id (parámetros mínimos recomendados por
// OWASP: 19 MiB de memoria, 2 iteraciones). Se eligen así y no más altos
// porque el contenedor de la API tiene un límite de 256 MB de RAM.
const argon2 = require('argon2');

const OPCIONES = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const MIN_LONGITUD = 10;

const hashear = (plano) => argon2.hash(plano, OPCIONES);

let hashFalso;
// Verifica la contraseña. Si el usuario no existe se verifica contra un hash
// falso igualmente, para que el tiempo de respuesta no delate qué usuarios existen.
async function verificar(hash, plano) {
  if (!hash) {
    hashFalso = hashFalso || (await hashear('contraseña-que-nadie-usa'));
    await argon2.verify(hashFalso, plano).catch(() => false);
    return false;
  }
  return argon2.verify(hash, plano).catch(() => false);
}

function validarPolitica(plano) {
  if (typeof plano !== 'string' || plano.length < MIN_LONGITUD || plano.length > 128) {
    return `La contraseña debe tener entre ${MIN_LONGITUD} y 128 caracteres`;
  }
  return null;
}

module.exports = { hashear, verificar, validarPolitica };
