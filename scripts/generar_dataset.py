#!/usr/bin/env python3
"""Genera el dataset sintético de EntregaSegura de forma REPRODUCIBLE.

Usa un generador pseudoaleatorio propio (LCG con semilla fija), así el
mismo comando produce exactamente los mismos bytes (y el mismo SHA-256)
en cualquier máquina. No contiene datos personales reales.

Uso:  python3 scripts/generar_dataset.py [carpeta_destino]
"""
import hashlib
import os
import sys

DESTINO = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "dataset")


class Lcg:
    """Generador congruencial lineal: determinista y portable."""

    def __init__(self, semilla):
        self.x = semilla

    def siguiente(self):
        self.x = (1103515245 * self.x + 12345) % (2 ** 31)
        return self.x

    def entero(self, a, b):
        return a + self.siguiente() % (b - a + 1)

    def elegir(self, lista):
        return lista[self.siguiente() % len(lista)]


NOMBRES = ["Ana", "Bruno", "Carla", "Diego", "Elena", "Felipe", "Gabriela", "Héctor", "Isabel", "Julián",
           "Karen", "Luis", "María", "Nicolás", "Olga", "Pablo", "Quintín", "Rosa", "Sergio", "Tatiana",
           "Úrsula", "Víctor", "Wilson", "Ximena", "Yesid", "Zoraida"]
APELLIDOS = ["Gómez", "Díaz", "Rojas", "Pérez", "Martínez", "López", "Suárez", "Castro", "Vargas", "Moreno",
             "Niño", "Cárdenas", "Rincón", "Becerra", "Salamanca", "Fonseca", "Ochoa", "Pinzón", "Reyes", "Tovar"]
PROGRAMAS = ["Sistemas", "Electrónica", "Industrial"]

SUJETOS = ["El planificador", "El núcleo", "Cada proceso", "La memoria virtual", "El sistema de archivos",
           "El controlador", "La cola de listos", "El hilo principal", "El semáforo", "La tabla de páginas",
           "El contenedor", "El servidor", "La caché", "El manejador de interrupciones"]
VERBOS = ["asigna", "libera", "supervisa", "sincroniza", "protege", "reparte", "registra", "atiende",
          "aísla", "reemplaza", "comparte", "bloquea", "despierta", "audita"]
OBJETOS = ["el tiempo de CPU", "los marcos de memoria", "las solicitudes de entrada y salida",
           "los recursos compartidos", "los descriptores de archivo", "las secciones críticas",
           "los permisos del usuario", "las páginas sucias", "los mensajes entre procesos",
           "la prioridad de cada tarea", "los bloques del disco", "las señales pendientes"]
COMPLEMENTOS = ["sin provocar inanición", "con una política de turno rotatorio", "para evitar interbloqueos",
                "respetando el principio de mínimo privilegio", "de forma atómica", "según su prioridad",
                "antes de cada cambio de contexto", "mientras mide la latencia", "dentro de un límite de recursos",
                "con registro en la bitácora de auditoría"]


def frase(r):
    return f"{r.elegir(SUJETOS)} {r.elegir(VERBOS)} {r.elegir(OBJETOS)} {r.elegir(COMPLEMENTOS)}."


def parrafo(r, n):
    return " ".join(frase(r) for _ in range(n))


def informe():
    r = Lcg(2026)
    partes = [
        "# Informe de laboratorio 1 · Procesos e hilos",
        "",
        "**Curso:** SO-101 Sistemas Operativos  ",
        "**Institución:** Corporación Educativa Altiplano (ficticia)  ",
        "**Autor:** estudiante de prueba (dataset sintético)",
        "",
        "## 1. Objetivo",
        "",
        parrafo(r, 4),
        "",
        "## 2. Marco teórico",
        "",
    ]
    for titulo in ["2.1 Procesos", "2.2 Hilos", "2.3 Planificación", "2.4 Sincronización"]:
        partes += [f"### {titulo}", "", parrafo(r, 9), ""]
    partes += ["## 3. Procedimiento", ""]
    for i in range(1, 8):
        partes.append(f"{i}. {frase(r)}")
    partes += ["", "## 4. Resultados", "", "| Prueba | Hilos | Tiempo (ms) | CPU (%) |", "|---|---|---|---|"]
    for i in range(1, 11):
        partes.append(f"| P{i:02d} | {2 ** (i % 4)} | {r.entero(40, 900)} | {r.entero(10, 99)} |")
    partes += ["", "## 5. Análisis", "", parrafo(r, 16), "", "## 6. Conclusiones", ""]
    for _ in range(4):
        partes.append(f"- {frase(r)}")
    partes += ["", "## 7. Referencias", "", "- Silberschatz, Galvin y Gagne. *Operating System Concepts*.",
               "- Tanenbaum y Bos. *Modern Operating Systems*.", ""]
    return "\n".join(partes)


def notas_csv():
    r = Lcg(101)
    filas = ["codigo,nombre,apellido,programa,parcial1,parcial2,taller,final"]
    for i in range(1, 801):
        p1, p2, t = r.entero(0, 50) / 10, r.entero(0, 50) / 10, r.entero(0, 50) / 10
        final = round(p1 * 0.3 + p2 * 0.3 + t * 0.4, 2)
        filas.append(f"2026{i:04d},{r.elegir(NOMBRES)},{r.elegir(APELLIDOS)},{r.elegir(PROGRAMAS)},"
                     f"{p1:.1f},{p2:.1f},{t:.1f},{final:.2f}")
    return "\n".join(filas) + "\n"


ALGORITMO = '''Algoritmos de ordenamiento - entrega de práctica (dataset sintético)
=====================================================================

# Quicksort (Python): O(n log n) en promedio, O(n^2) en el peor caso.
def quicksort(lista):
    if len(lista) <= 1:
        return lista
    pivote = lista[len(lista) // 2]
    menores = [x for x in lista if x < pivote]
    iguales = [x for x in lista if x == pivote]
    mayores = [x for x in lista if x > pivote]
    return quicksort(menores) + iguales + quicksort(mayores)


# Mergesort (Python): O(n log n) siempre, estable, usa memoria extra O(n).
def mergesort(lista):
    if len(lista) <= 1:
        return lista
    medio = len(lista) // 2
    izquierda = mergesort(lista[:medio])
    derecha = mergesort(lista[medio:])
    resultado = []
    i = j = 0
    while i < len(izquierda) and j < len(derecha):
        if izquierda[i] <= derecha[j]:
            resultado.append(izquierda[i])
            i += 1
        else:
            resultado.append(derecha[j])
            j += 1
    resultado.extend(izquierda[i:])
    resultado.extend(derecha[j:])
    return resultado


// Inserción (Java): O(n^2), muy bueno para listas casi ordenadas.
public static void insercion(int[] a) {
    for (int i = 1; i < a.length; i++) {
        int clave = a[i];
        int j = i - 1;
        while (j >= 0 && a[j] > clave) {
            a[j + 1] = a[j];
            j--;
        }
        a[j + 1] = clave;
    }
}

Pruebas:
    quicksort([5, 3, 8, 1, 9, 2])  -> [1, 2, 3, 5, 8, 9]
    mergesort([10, -1, 7, 7, 0])   -> [-1, 0, 7, 7, 10]

Comparación en este equipo (10 000 enteros aleatorios):
    quicksort   18 ms
    mergesort   24 ms
    insercion  910 ms

Conclusión: para datos grandes conviene un algoritmo O(n log n);
inserción solo se justifica con listas pequeñas o casi ordenadas.
'''


def metadatos_json():
    return """{
  "curso": "SO-101",
  "actividad": "Informe de laboratorio 1",
  "grupo": 3,
  "integrantes": ["estudiante_a", "estudiante_b", "estudiante_c"],
  "herramientas": {"lenguaje": "C", "compilador": "gcc 14", "so": "Ubuntu 24.04"},
  "entregables": ["informe.md", "codigo.c", "medidas.csv"],
  "horas_dedicadas": 12.5,
  "notas": "Archivo JSON de ejemplo del dataset sintético"
}
"""


def texto_de_tamano(semilla, bytes_objetivo):
    r = Lcg(semilla)
    partes = []
    total = 0
    n = 0
    while total < bytes_objetivo:
        n += 1
        bloque = (f"## Sección {n}\n\n" if n % 25 == 1 else "") + parrafo(r, 6) + "\n\n"
        partes.append(bloque)
        total += len(bloque.encode("utf-8"))
    datos = "".join(partes).encode("utf-8")[:bytes_objetivo]
    # No cortar un carácter UTF-8 a la mitad
    while True:
        try:
            datos.decode("utf-8")
            return datos
        except UnicodeDecodeError:
            datos = datos[:-1]


def binario():
    # Cabecera tipo ejecutable de Windows (MZ) + bytes que NO son UTF-8 válido
    r = Lcg(7)
    cabecera = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00"
    cuerpo = bytes((0x80 | (r.siguiente() & 0x7F)) if i % 3 else 0xFF for i in range(51200 - len(cabecera)))
    return cabecera + cuerpo


def main():
    os.makedirs(DESTINO, exist_ok=True)
    inf = informe().encode("utf-8")
    archivos = {
        "informe_laboratorio.md": inf,
        "notas_parcial_sintetico.csv": notas_csv().encode("utf-8"),
        "algoritmo_ordenamiento.txt": ALGORITMO.encode("utf-8"),
        "informe_copia.md": inf,  # idéntico a propósito
        "metadatos_entrega.json": metadatos_json().encode("utf-8"),
        "ensayo_largo.txt": texto_de_tamano(48, 4_800_000),
        "ensayo_excedido.txt": texto_de_tamano(60, 6_000_000),
        "binario_disfrazado.txt": binario(),
    }
    for nombre, datos in archivos.items():
        with open(os.path.join(DESTINO, nombre), "wb") as f:
            f.write(datos)
        print(f"{nombre:30s} {len(datos):>10,d} B  sha256={hashlib.sha256(datos).hexdigest()}")


if __name__ == "__main__":
    main()
