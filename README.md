# Código Rojo en la Red — Escape room de diagnóstico (1º ASIR · PAR · UD2)

Web estática (HTML/CSS/JS, sin backend) para GitHub Pages. Incluye un **simulador de la red de clase** que imita Packet Tracer:
tres routers (R1, R2, R3) unidos por la red común 10.0.0.0/24, una LAN por router, DHCP en cada router, RIPv2 y un servidor DNS en Producción.

## Archivos
```
index.html      Juego del alumnado
profesor.html   Ranking + solucionario por equipo (PIN por defecto: 1ASIR)
js/net.js       Simulador: rutas C/L/S/R, RIP, DHCP, decisión local/remoto, ping, tracert, nslookup y CLI IOS
js/core.js      Red base, 5 tickets con variantes por equipo, CONFIG (secreto, PIN, puntos)
js/app.js       Interfaz: mapa, consolas, fases, parte de incidencia, informe final
```

## Los 5 tickets (cada uno parte de la red sana con un único fallo)
| # | Ticket | Fallo (varía por equipo) | Tipo |
|---|--------|--------------------------|------|
| 1 | Una sede desconectada | `shutdown` en la G0/0 de un router | Físico |
| 2 | El portátil configurado a mano | Máscara /25 o /16 en un PC estático | Direccionamiento |
| 3 | El PC nuevo | Pool DHCP con `default-router` erróneo **o** exclusiones que ocupan todo el rango | Configuración de red |
| 4 | La sede invisible / El camino de vuelta | Falta `network` de la LAN en RIP **o** falta la ruta estática de vuelta | Configuración de red |
| 5 | La intranet no abre | DNS erróneo en el pool **o** en el PC | Servicios |

Cada ticket sigue las fases **Observar → Comprobar → Localizar → Corregir → Verificar → Documentar**:
- Corregir y verificar se comprueban sobre el estado real de la red simulada (no basta con responder).
- Al final se rellena un **parte de incidencia** (tipo, dispositivo, causa, comando de evidencia y justificación).
- Al terminar se descarga una **hoja de resultados** (.txt) con síntomas, pruebas, diagnóstico, corrección y verificación de cada ticket, más un código de finalización para el ranking.

## Fidelidad con Packet Tracer
- PC: pestañas **Command Prompt** e **IP Configuration** (DHCP / Static), `ipconfig`, `ipconfig /all`, `/renew`, `/release`, `ping`, `tracert`, `nslookup`.
- Router: modos `>` `#` `(config)#` `(config-if)#` `(config-router)#` `(dhcp-config)#`, abreviaturas, `?`, `do`.
- Comandos: `show ip interface brief`, `show ip route`, `show ip dhcp binding`, `show running-config`, `show ip protocols`, `ping`, `interface`, `(no) shutdown`, `ip address`, `router rip`, `version 2`, `network`, `no auto-summary`, `ip route`, `ip dhcp pool`, `network`, `default-router`, `dns-server`, `ip dhcp excluded-address`, `write`, `copy running-config startup-config`.
- Las salidas imitan el formato de PT. **Son simuladas**: se avisa en la interfaz.

## Reproducirlo en Packet Tracer
En `profesor.html` → Solucionario, cada ticket indica el **fallo exacto** que tiene ese equipo, para introducirlo en el `.pkt` de clase si se quiere hacer la misma incidencia en PT.

## Varias sesiones
Botón 💾 para descargar la partida y «Cargar partida guardada» en la siguiente clase (también en otro PC). El archivo está firmado.

## Prueba
`js/net.js` y `js/core.js` funcionan también en Node: se probaron 300 equipos × 5 tickets (1500 escenarios). Todos empiezan rotos y se arreglan con los comandos IOS correctos.

## Actividad individual, ranking automático y PDF
- Cada alumno entra con **nombre y apellidos**.
- **Ranking automático**: el juego envía la puntuación a una Hoja de cálculo de Google (Apps Script) al empezar, al cerrar cada ticket y al terminar. El panel del profesor (pestaña *Ranking en directo*) se refresca cada 15 s, muestra el mejor intento de cada alumno y permite exportar a CSV.
  1. Crea una Hoja de cálculo de Google → *Extensiones → Apps Script* → pega `apps-script/Codigo.gs`.
  2. Cambia `const PIN = "CAMBIA-ESTE-PIN";` por tu PIN (no se publica en la web).
  3. *Implementar → Nueva implementación → Aplicación web* · Ejecutar como **Yo** · Acceso **Cualquier usuario**.
  4. Copia la URL `/exec` en `RANKING_URL` de `js/core.js` y publica.
- **Informe PDF**: al terminar, el alumno descarga `CodigoRojo_Nombre_Apellidos.pdf` (datos, resumen, detalle de los 5 tickets y código de verificación) para subirlo al campus. En el panel, pestaña *Comprobar PDF*, se valida ese código.
- Consola de router: abreviaturas como en Packet Tracer (`en`, `conf t`, `config t`, `int g0/0`, `no shut`, `sh ip int br`, `sh run`, `wr`…), **Tab** autocompleta según el modo y `?` muestra la ayuda.

## Nota sobre 10 e informe parcial
- El PDF incluye una **nota sobre 10** (editable en `CONFIG.GRADE` de `js/core.js`): cada ticket vale 2 puntos; ticket cerrado = 2 − 0,25 por pista − 0,25 por parte erróneo (mínimo 1); corregido y verificado sin parte = 1; sin resolver = 0.
- Botón **📄** en la cabecera: descarga el informe en cualquier momento. Antes de terminar genera un **informe PARCIAL** (banda roja, nota provisional, tickets pendientes marcados) con nombre `_PARCIAL.pdf`.
- La nota, el número de tickets y si es parcial o final van dentro del código de verificación: en *Comprobar PDF* se ven y cualquier edición invalida el código.
- Los títulos de los tickets y la barra de progreso son neutros (no revelan el tipo de fallo).

## Puntos que se ganan, tiempo y rapidez
- Puntos (se ganan, empiezan en 0): +200 por ticket cerrado, +50 si es sin errores, −25 por parte erróneo, −50 por pista, rapidez hasta +250 al terminar. Se recalculan siempre a partir del progreso (`CONFIG.POINTS`).
- Se registran inicio, fin y **tiempo de trabajo activo** (solo con la web abierta y en uso; más de 5 min sin actividad no cuenta).
- Nota: 8 puntos por tickets (1,6 cada uno, −0,2 por pista o parte erróneo, mínimo 0,8) + 2 por rapidez si se terminan los 5 (≤ 45 min = 2; ≥ 105 min = 0). Configurable en `CONFIG.GRADE` y `CONFIG.SPEED`.
