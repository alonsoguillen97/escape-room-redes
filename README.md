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
