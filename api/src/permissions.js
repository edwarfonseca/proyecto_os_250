'use strict';
// =====================================================================
// MATRIZ DE PERMISOS (RBAC) · ÚNICA FUENTE DE VERDAD
// ---------------------------------------------------------------------
// Rol -> lista de acciones que puede intentar.
// Ojo: esto solo dice QUÉ puede hacer cada rol. SOBRE QUÉ recursos
// (sus cursos, sus entregas) lo decide middleware/scope.js.
//
// Reto 2 (cambio de permisos): añadir o quitar una acción aquí y
// reconstruir la API:  docker compose up -d --build api
// =====================================================================

const PERMISOS = Object.freeze({
  admin: [
    'usuario:listar',
    'usuario:crear',
    'usuario:modificar',
    'curso:listar',
    'curso:crear',
    'curso:matricular',
    'curso:ver_estudiantes',
    'actividad:listar',
    'entrega:metadatos',      // ve metadatos, NUNCA el contenido
    'trabajo:reprocesar',
    'trazabilidad:ver',
    'auditoria:ver',
    'sistema:estado',
  ],
  docente: [
    'curso:listar',
    'curso:ver_estudiantes',
    'actividad:listar',
    'actividad:crear',
    'prorroga:otorgar',
    'entrega:metadatos',
    'entrega:listar_curso',
    'entrega:descargar',
    'resultado:ver',
    'duplicado:ver',          // solo el docente ve la marca posible_duplicado
    'trabajo:reprocesar',
    'trazabilidad:ver',
  ],
  estudiante: [
    'curso:listar',
    'actividad:listar',
    'entrega:subir',
    'entrega:reemplazar',
    'entrega:eliminar',
    'entrega:metadatos',
    'entrega:listar_propias',
    'entrega:descargar',
    'resultado:ver',
  ],
});

function puede(rol, accion) {
  const lista = PERMISOS[rol];
  return Array.isArray(lista) && lista.includes(accion);
}

module.exports = { PERMISOS, puede };
