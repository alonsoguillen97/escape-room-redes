/* =========================================================
   CÓDIGO ROJO EN LA RED — núcleo (alumno + profesor)
   Red de clase (3 routers) + 5 tickets con fallos distintos por grupo.
   ========================================================= */
(function (g) {
  "use strict";
  const CONFIG = {
    SECRET: "CODIGO-ROJO|1ASIR|PAR|UD2|v1", // cámbialo cada curso
    TEACHER_PIN: "1ASIR",           // solo para el panel si NO hay ranking automático
    RANKING_URL: "https://script.google.com/macros/s/AKfycbxYAyEkhlNKzGRbpikk5GCFhFhSRllazCFFHllmgltnBquFuww4j0NBv3_UHSBsB6BP/exec",                // URL de la aplicación web de Apps Script (ver README)
    PENALTY_WRONG: 25,
    PENALTY_HINT: 50,
    BONUS_CLEAN: 50,
    START_SCORE: 1000,
    // Nota sobre 10 que aparece en el informe PDF (5 tickets × 2 puntos)
    // Nota: 8 puntos por tickets (1,6 cada uno) + 2 por rapidez (solo si se terminan los 5)
    GRADE: { TICKET: 1.6, HINT: 0.2, WRONG: 0.2, MIN_CLOSED: 0.8, VERIFIED_ONLY: 0.8, SPEED: 2 },
    // Rapidez según minutos de trabajo activo: <= FAST_MIN → máximo; >= SLOW_MIN → 0; lineal entre medias
    SPEED: { FAST_MIN: 45, SLOW_MIN: 105, IDLE_MIN: 5 },
    // Puntos del juego (se ganan): por ticket cerrado, extra si es limpio, penalizaciones y rapidez
    POINTS: { TICKET: 200, CLEAN: 50, WRONG: 25, HINT: 50, SPEED: 250 },
  };
  const enc = new TextEncoder();
  const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  async function sha256(t) { return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(t)))); }

  /* ---------- PRNG ---------- */
  function xmur3(str) { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; }; }
  function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function rng(seed) { const r = mulberry32(xmur3(seed)()); return { next: r, int: (a, b) => a + Math.floor(r() * (b - a + 1)), pick: (arr) => arr[Math.floor(r() * arr.length)], shuffle: (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; } }; }
  const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function generateGroupCode() {
    for (;;) {
      const b = crypto.getRandomValues(new Uint8Array(4));
      const c = Array.from(b, (x) => ALPH[x % ALPH.length]).join("");
      if (!/^\d*E\d+$|^\d+$/.test(c)) return c;
    }
  }

  /* ---------- Red de clase ---------- */
  const LANS = {
    R1: { net: "192.168.20", dept: "Administración", short: "ADM", pool: "ADMINISTRACION", seg: "LAN-R1", transit: "10.0.0.1" },
    R2: { net: "192.168.10", dept: "Comercial", short: "COM", pool: "COMERCIAL", seg: "LAN-R2", transit: "10.0.0.2" },
    R3: { net: "192.168.30", dept: "Producción", short: "PRO", pool: "PRODUCCION", seg: "LAN-R3", transit: "10.0.0.3" },
  };
  const ROUTERS = ["R1", "R2", "R3"];
  const SRV_IP = "192.168.30.10";
  const MASK24 = "255.255.255.0";
  const lanOfHost = (hn) => (hn.startsWith("ADM") ? "R1" : hn.startsWith("COM") ? "R2" : "R3");
  const hostsOf = (r) => [LANS[r].short + "-1", LANS[r].short + "-2"].concat(r === "R3" ? ["SRV-DNS"] : []);

  function mac(r) { const h = () => r.int(0, 255).toString(16).padStart(2, "0").toUpperCase(); return `00${h()}.${h()}${h()}.${h()}${h()}`.replace(/^00(..)/, "00$1"); }

  function baseline(d, { routing = "rip" } = {}) {
    const N = { routers: {}, hosts: {}, dns: { "intranet.cited.local": SRV_IP, "srv-dns.cited.local": SRV_IP, "www.cited.local": SRV_IP } };
    for (const r of ROUTERS) {
      const L = LANS[r];
      N.routers[r] = {
        ifaces: {
          "GigabitEthernet0/0": { ip: `${L.net}.1`, mask: MASK24, shut: false, seg: L.seg },
          "GigabitEthernet0/1": { ip: L.transit, mask: MASK24, shut: false, seg: "TRANSIT" },
        },
        rip: routing === "rip" ? { on: true, version: 2, noAuto: true, nets: ["10.0.0.0", `${L.net}.0`] } : null,
        statics: [],
        dhcp: { excluded: [[`${L.net}.1`, `${L.net}.${d.excl[r]}`]], pools: [{ name: L.pool, network: `${L.net}.0`, mask: MASK24, router: `${L.net}.1`, dns: SRV_IP }] },
        leases: [],
      };
      if (routing === "static") {
        for (const o of ROUTERS) if (o !== r) N.routers[r].statics.push({ net: `${LANS[o].net}.0`, mask: MASK24, nh: LANS[o].transit });
      }
    }
    for (const r of ROUTERS) {
      for (const hn of hostsOf(r)) {
        if (hn === "SRV-DNS") N.hosts[hn] = { seg: LANS.R3.seg, mac: d.macs[hn], dhcp: false, ip: SRV_IP, mask: MASK24, gw: "192.168.30.1", dns: SRV_IP, dnsServer: true };
        else N.hosts[hn] = { seg: LANS[r].seg, mac: d.macs[hn], dhcp: true, ip: "", mask: "", gw: "", dns: "" };
      }
    }
    return N;
  }
  function leaseAll(N, only) {
    for (const [hn, h] of Object.entries(N.hosts)) if (h.dhcp && (!only || only.includes(hn))) NET.dhcpRequest(N, hn);
  }

  /* ---------- Datos del grupo ---------- */
  const cache = {};
  function deriveGroup(code) {
    if (cache[code]) return cache[code];
    const r = rng(CONFIG.SECRET + "#" + code);
    const d = { code };
    d.excl = { R1: r.int(20, 60), R2: r.int(20, 60), R3: r.int(20, 60) };
    d.macs = {};
    for (const hn of ["ADM-1", "ADM-2", "COM-1", "COM-2", "PRO-1", "PRO-2", "SRV-DNS"]) d.macs[hn] = mac(r);
    const order = r.shuffle(ROUTERS);
    // T1 · interfaz apagada
    d.t1 = { router: order[0] };
    // T2 · máscara
    d.t2 = { router: r.pick(ROUTERS), variant: r.pick(["25", "16"]), host: 0 };
    d.t2.host = d.t2.variant === "25" ? r.int(140, 220) : r.int(100, 220);
    // T3 · DHCP
    d.t3 = { router: order[1], variant: r.pick(["gw", "excl"]) };
    const others = ROUTERS.filter((x) => x !== d.t3.router);
    d.t3.wrongGw = r.pick([`${LANS[d.t3.router].net}.254`, `${LANS[r.pick(others)].net}.1`, `${LANS[d.t3.router].net}.${r.int(2, 9)}`]);
    // T4 · enrutamiento
    d.t4 = { variant: r.pick(["rip", "static"]), z: order[2] };
    d.t4.a = r.pick(ROUTERS.filter((x) => x !== d.t4.z));
    // T5 · DNS
    d.t5 = { variant: r.pick(["pool", "pc"]), router: r.pick(["R1", "R2"]) };
    d.t5.wrongDns = r.pick(["8.8.8.8", "192.168.30.1", "192.168.30.11", `${LANS[d.t5.router].net}.1`]);
    cache[code] = d;
    return d;
  }

  /* ---------- Tickets ---------- */
  const CATS = { fisico: "Físico", direccionamiento: "Direccionamiento", red: "Configuración de red", servicios: "Servicios" };
  const CMDS = ["ipconfig /all", "ping", "tracert", "nslookup", "show ip interface brief", "show ip route", "show ip dhcp binding", "show running-config"];

  // Comprueba que un cliente nuevo de ese router recibiría una configuración válida
  function freshClientOk(N, router) {
    const M = NET.clone(N);
    const L = LANS[router];
    M.hosts["__NUEVO"] = { seg: L.seg, mac: "00FF.FFFF.FFFF", dhcp: true, ip: "", mask: "", gw: "", dns: "" };
    NET.dhcpRequest(M, "__NUEVO");
    const h = M.hosts.__NUEVO;
    if (!h.ip.startsWith(L.net + ".") || h.gw !== `${L.net}.1` || h.mask !== MASK24) return false;
    return NET.resolve(M, "__NUEVO", "intranet.cited.local").ok;
  }

  function tickets(d) {
    const T1 = d.t1.router, L1 = LANS[T1];
    const L2 = LANS[d.t2.router];
    const T3 = d.t3.router, L3 = LANS[T3];
    const Z = d.t4.z, A = d.t4.a, LZ = LANS[Z], LA = LANS[A];
    const T5 = d.t5.router, L5 = LANS[T5];
    const t2target = L2.short + "-2";
    const t3target = L3.short + "-2";
    const t5target = L5.short + "-1";
    const remoteOf = (r) => ROUTERS.filter((x) => x !== r);
    return [
      {
        id: "t1", title: "Llamada urgente de " + L1.dept, keyword: "FÍSICO", place: "Planta de " + L1.dept,
        quote: `Nadie en ${L1.dept} puede trabajar: no llegamos a ningún servidor ni a las otras sedes. Entre nosotros sí nos vemos… creo.`,
        reporter: `Usuario de ${L1.dept}`, affected: hostsOf(T1).filter((h) => h !== "SRV-DNS"),
        build() { const N = baseline(d); leaseAll(N); N.routers[T1].ifaces["GigabitEthernet0/0"].shut = true; return N; },
        target: L1.short + "-1",
        verify: (e, N) => e.kind === "ping" && e.ok && lanOfHost(e.from) === T1 && !e.dst.startsWith(L1.net + "."),
        fixed: (N) => NET.health(N).ok,
        answer: { cat: "fisico", device: T1, cause: "ifdown", cmds: ["show ip interface brief", "show running-config"] },
        causes: [
          { id: "ifdown", t: `La interfaz LAN de ${T1} está apagada administrativamente (shutdown)` },
          { id: "cable", t: "El cable de red de los PC está desconectado" },
          { id: "dhcp", t: "El pool DHCP se ha quedado sin direcciones" },
          { id: "rip", t: `${T1} no anuncia su LAN por RIP` },
          { id: "mask", t: "Los PC tienen una máscara incorrecta" },
        ],
        hints: [
          `Desde un PC de ${L1.dept}: ¿llega el ping a su puerta de enlace? Si ni siquiera llega al gateway, mira el router.`,
          `En ${T1}, show ip interface brief muestra el estado de cada interfaz. Para encenderla: interface … y no shutdown.`,
        ],
        lesson: "Si un equipo no llega ni a su puerta de enlace, el problema está en el tramo local: cable, switch o la interfaz del router. <b>show ip interface brief</b> muestra el estado de cada interfaz; <code>administratively down</code> significa que alguien la apagó con <code>shutdown</code> y se activa con <code>no shutdown</code>.",
        solution: `${T1}: enable → configure terminal → interface GigabitEthernet0/0 → no shutdown. Verificar: ping desde ${L1.short}-1 a otra LAN.`,
      },
      {
        id: "t2", title: "Un usuario de " + L2.dept + " se queja", keyword: "MÁSCARA", place: "Oficina de " + L2.dept,
        quote: d.t2.variant === "25"
          ? `Me han configurado el portátil (${t2target}) a mano y no llego a nada. Mis compañeros de al lado funcionan perfectamente.`
          : `Mi equipo (${t2target}) llega al router, pero no consigo abrir nada de las otras sedes. Mis compañeros sí pueden.`,
        reporter: `Usuario de ${L2.dept}`, affected: [t2target],
        build() {
          const N = baseline(d); leaseAll(N);
          const h = N.hosts[t2target];
          Object.assign(h, { dhcp: false, ip: `${L2.net}.${d.t2.host}`, mask: d.t2.variant === "25" ? "255.255.255.128" : "255.255.0.0", gw: `${L2.net}.1`, dns: SRV_IP, dhcpServer: "" });
          return N;
        },
        target: t2target,
        verify: (e) => e.kind === "ping" && e.ok && e.from === t2target && !e.dst.startsWith(L2.net + "."),
        fixed: (N) => NET.health(N).ok,
        answer: { cat: "direccionamiento", device: t2target, cause: "mask", cmds: ["ipconfig /all"] },
        causes: [
          { id: "mask", t: "El PC tiene una máscara de subred incorrecta" },
          { id: "gw", t: "La puerta de enlace del PC es la de otra LAN" },
          { id: "ifdown", t: `La interfaz LAN de ${d.t2.router} está apagada` },
          { id: "dup", t: "La IP del PC está duplicada con otro equipo" },
          { id: "dns", t: "El servidor DNS del PC es incorrecto" },
        ],
        hints: [
          "Compara la configuración de este PC (ipconfig /all) con la de un compañero que sí funciona.",
          d.t2.variant === "25" ? "Con esa máscara, ¿la puerta de enlace está dentro de la misma red que el PC?" : "Con esa máscara, ¿qué destinos cree el PC que están en su propia red? ¿Los manda al gateway?",
        ],
        lesson: "El PC decide con su <b>máscara</b> si un destino es local o remoto. Con una máscara incorrecta puede creer que el gateway está fuera de su red, o que redes remotas son locales y no mandarlas al router. Se diagnostica con <b>ipconfig /all</b> comparando con un equipo que funciona.",
        solution: `${t2target}: IP Configuration → máscara 255.255.255.0 (o pasar a DHCP). Verificar: ping a otra LAN.`,
      },
      {
        id: "t3", title: "Aviso del responsable de " + L3.dept, keyword: "DHCP", place: "Oficina de " + L3.dept,
        quote: d.t3.variant === "gw"
          ? `Hemos conectado un equipo nuevo (${t3target}). Coge IP sin problema, pero no sale de la oficina.`
          : `Hemos conectado un equipo nuevo (${t3target}) y no consigue configuración. Los equipos antiguos funcionan.`,
        reporter: `Responsable de ${L3.dept}`, affected: [t3target],
        build() {
          const N = baseline(d); leaseAll(N);
          const R = N.routers[T3];
          if (d.t3.variant === "gw") R.dhcp.pools[0].router = d.t3.wrongGw;
          else R.dhcp.excluded = [[`${L3.net}.1`, `${L3.net}.254`]];
          const h = N.hosts[t3target];
          R.leases = R.leases.filter((l) => l.mac !== h.mac);
          Object.assign(h, { ip: "", mask: "", gw: "", dns: "" });
          NET.dhcpRequest(N, t3target);
          return N;
        },
        target: t3target,
        verify: (e) => e.kind === "ping" && e.ok && e.from === t3target && !e.dst.startsWith(L3.net + "."),
        fixed: (N) => NET.health(N).ok && freshClientOk(N, T3) && N.hosts[t3target].dhcp,
        answer: { cat: "red", device: T3, cause: d.t3.variant === "gw" ? "pool-gw" : "pool-excl", cmds: ["ipconfig /all", "show running-config", "show ip dhcp binding"] },
        causes: [
          { id: "pool-gw", t: "El pool DHCP entrega una puerta de enlace incorrecta" },
          { id: "pool-excl", t: "Las direcciones excluidas ocupan todo el rango del pool" },
          { id: "ifdown", t: `La interfaz LAN de ${T3} está apagada` },
          { id: "mask", t: "El PC nuevo tiene la máscara mal escrita a mano" },
          { id: "rip", t: `${T3} no anuncia su LAN por RIP` },
        ],
        hints: [
          d.t3.variant === "gw" ? "ipconfig /all en el PC nuevo: ¿qué puerta de enlace ha recibido? ¿Es la IP del router?" : "ipconfig /all en el PC nuevo: una IP 169.254.x.x significa que no ha recibido respuesta del DHCP.",
          `En ${T3}: show running-config muestra el pool y las direcciones excluidas. Tras corregir, en el PC: ipconfig /renew.`,
        ],
        lesson: "Recibir una IP por DHCP <b>no garantiza</b> que todo funcione: el pool también entrega la puerta de enlace y el DNS. Una IP <code>169.254.x.x</code> indica que el cliente no obtuvo concesión. Se diagnostica comparando <b>ipconfig /all</b> con la configuración del pool y <b>show ip dhcp binding</b>.",
        solution: d.t3.variant === "gw"
          ? `${T3}: configure terminal → ip dhcp pool ${L3.pool} → default-router ${L3.net}.1. En ${t3target}: ipconfig /renew.`
          : `${T3}: configure terminal → no ip dhcp excluded-address ${L3.net}.1 ${L3.net}.254 → ip dhcp excluded-address ${L3.net}.1 ${L3.net}.${d.excl[T3]}. En ${t3target}: ipconfig /renew.`,
      },
      {
        id: "t4", title: "Queja de coordinación", keyword: "RUTAS", place: "Coordinación",
        quote: d.t4.variant === "rip"
          ? `Desde ${LA.dept} no llegamos a los equipos de ${LZ.dept}. Y por lo visto desde otras sedes tampoco. Dentro de ${LZ.dept} todo va bien.`
          : `${LA.dept} y ${LZ.dept} no se comunican entre sí. Lo curioso es que las dos llegan sin problemas a la tercera sede.`,
        reporter: "Coordinación", affected: [LA.short + "-1", LZ.short + "-1"],
        build() {
          const N = baseline(d, { routing: d.t4.variant === "rip" ? "rip" : "static" }); leaseAll(N);
          if (d.t4.variant === "rip") N.routers[Z].rip.nets = N.routers[Z].rip.nets.filter((n) => n !== `${LZ.net}.0`);
          else N.routers[Z].statics = N.routers[Z].statics.filter((s) => s.net !== `${LA.net}.0`);
          return N;
        },
        target: LA.short + "-1",
        verify: (e) => e.kind === "ping" && e.ok && ((lanOfHost(e.from) === A && e.dst.startsWith(LZ.net + ".")) || (lanOfHost(e.from) === Z && e.dst.startsWith(LA.net + "."))),
        fixed: (N) => NET.health(N).ok,
        answer: { cat: "red", device: Z, cause: d.t4.variant === "rip" ? "rip" : "return", cmds: ["show ip route", "show running-config", "tracert"] },
        causes: [
          { id: "rip", t: `${Z} no anuncia su LAN (${LZ.net}.0) por RIP` },
          { id: "return", t: `A ${Z} le falta la ruta de vuelta hacia ${LA.net}.0` },
          { id: "ifdown", t: `La interfaz hacia la red común de ${Z} está apagada` },
          { id: "dhcp", t: `El pool DHCP de ${Z} entrega un gateway incorrecto` },
          { id: "mask", t: `Los PC de ${LZ.dept} tienen la máscara incorrecta` },
        ],
        hints: [
          d.t4.variant === "rip" ? `Compara show ip route en los tres routers: ¿todos conocen la red ${LZ.net}.0? ¿Con qué código (R, C)?` : `tracert desde ${LA.short}-1 a un equipo de ${LZ.dept}: ¿hasta dónde llega? Recuerda que la respuesta también necesita volver.`,
          d.t4.variant === "rip" ? `Si una red no aparece en los demás, revisa el router rip del router que la tiene conectada (show running-config).` : `Revisa show ip route en ${Z}: ¿sabe llegar a ${LA.net}.0? Una ruta estática: ip route RED MASCARA SIGUIENTE_SALTO.`,
        ],
        lesson: d.t4.variant === "rip"
          ? "Con RIP, cada router solo anuncia las redes incluidas en sus sentencias <code>network</code>. Si falta la LAN, el resto de routers no aprenden la ruta (no aparece con código <b>R</b> en <b>show ip route</b>) y nadie puede llegar a ella."
          : "Una comunicación necesita ruta de <b>ida y de vuelta</b>. Si a un router le falta la ruta de retorno, el paquete llega pero la respuesta se pierde. <b>tracert</b> muestra dónde se corta y <b>show ip route</b> confirma qué ruta falta.",
        solution: d.t4.variant === "rip"
          ? `${Z}: configure terminal → router rip → network ${LZ.net}.0. Verificar: ping de ${LA.short}-1 a ${LZ.short}-1.`
          : `${Z}: configure terminal → ip route ${LA.net}.0 255.255.255.0 ${LA.transit}. Verificar: ping de ${LA.short}-1 a ${LZ.short}-1.`,
      },
      {
        id: "t5", title: "Usuario de " + L5.dept + " sin servicio", keyword: "DNS", place: "Oficina de " + L5.dept,
        quote: `No me abre intranet.cited.local. Pero el técnico dice que si escribe la IP del servidor (${SRV_IP}) sí responde. ¿Qué está pasando?`,
        reporter: `Usuario de ${L5.dept} (${t5target})`, affected: d.t5.variant === "pool" ? hostsOf(T5) : [t5target],
        build() {
          const N = baseline(d); leaseAll(N);
          if (d.t5.variant === "pool") { N.routers[T5].dhcp.pools[0].dns = d.t5.wrongDns; leaseAll(N, hostsOf(T5)); }
          else Object.assign(N.hosts[t5target], { dhcp: false, dns: d.t5.wrongDns, dhcpServer: "" });
          return N;
        },
        target: t5target,
        verify: (e) => e.from === t5target && e.ok && (e.kind === "nslookup" || (e.kind === "ping" && e.byName)),
        fixed: (N) => {
          // los demás PC de la sede se arreglarán al renovar su concesión: basta con el pool correcto y el PC del ticket
          const rest = NET.health(N).fails.filter((f) => !(d.t5.variant === "pool" && f.endsWith(" DNS") && f.split(" ")[0] !== t5target && hostsOf(T5).includes(f.split(" ")[0])));
          return rest.length === 0 && (d.t5.variant === "pool" ? freshClientOk(N, T5) : true);
        },
        answer: { cat: "servicios", device: d.t5.variant === "pool" ? T5 : t5target, cause: d.t5.variant === "pool" ? "dns-pool" : "dns-pc", cmds: ["nslookup", "ipconfig /all"] },
        causes: [
          { id: "dns-pool", t: "El pool DHCP entrega un servidor DNS incorrecto" },
          { id: "dns-pc", t: "El PC tiene un servidor DNS incorrecto configurado a mano" },
          { id: "srv", t: "El servidor 192.168.30.10 está apagado" },
          { id: "gw", t: "El PC tiene mal la puerta de enlace" },
          { id: "route", t: "Falta una ruta hacia la LAN de Producción" },
        ],
        hints: [
          "Si por IP funciona y por nombre no, la conectividad está bien: revisa la resolución de nombres (nslookup) y qué servidor DNS usa el PC (ipconfig /all).",
          d.t5.variant === "pool" ? `El PC usa DHCP: ¿de dónde sale el DNS que recibe? Revisa el pool de ${T5}. Tras corregir: ipconfig /renew.` : "Ese PC no usa DHCP: su DNS se escribió a mano en IP Configuration.",
        ],
        lesson: "Si un equipo llega por IP pero no por nombre, la conectividad está bien y el fallo es de <b>servicios</b>: la resolución DNS. <b>nslookup</b> muestra qué servidor DNS se usa y si responde. Ojo: no todo fallo de nombre es del servidor; aquí el cliente apuntaba a un DNS equivocado.",
        solution: d.t5.variant === "pool"
          ? `${T5}: configure terminal → ip dhcp pool ${L5.pool} → dns-server ${SRV_IP}. En ${t5target}: ipconfig /renew. Verificar: nslookup intranet.cited.local.`
          : `${t5target}: IP Configuration → DNS ${SRV_IP} (o pasar a DHCP). Verificar: nslookup intranet.cited.local.`,
      },
    ];
  }

  /* ---------- Código de finalización y partidas guardadas ---------- */
  function b64u(str) { let bin = ""; enc.encode(str).forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))); }
  async function makeFinishCode(res) {
    const team = String(res.team || "").replace(/[|]/g, "/").slice(0, 60);
    // tickets y "P" (parcial) / "F" (final) van al final para que los códigos antiguos sigan siendo válidos
    const payload = [res.group, team, res.elapsed, res.score, res.hints, res.errors, res.end, res.tickets == null ? 5 : res.tickets, res.partial ? "P" : "F", res.grade == null ? "" : res.grade].join("|");
    return `CR.${b64u(payload)}.${(await sha256(CONFIG.SECRET + "#FIN#" + payload)).slice(0, 8).toUpperCase()}`;
  }
  async function parseFinishCode(code) {
    try {
      const [p, body, chk] = code.trim().split(".");
      if (p !== "CR" || !body || !chk) return null;
      const payload = unb64u(body);
      const ok = (await sha256(CONFIG.SECRET + "#FIN#" + payload)).slice(0, 8).toUpperCase() === chk.toUpperCase();
      const [group, team, elapsed, score, hints, errors, end, tickets, kind, grade] = payload.split("|");
      return { valid: ok, group, team, elapsed: +elapsed, score: +score, hints: +hints, errors: +errors, end: +end, tickets: tickets == null ? 5 : +tickets, partial: kind === "P", grade: grade ? +grade : null };
    } catch (e) { return null; }
  }
  /* ---------- Tiempo, puntos y nota ---------- */
  function activeMin(S) {
    if (S.activeMs != null) return S.activeMs / 60000;
    return Math.max(0, ((S.endTime || Date.now()) - S.startTime) / 60000);
  }
  function speedFactor(S) {
    if (!S.finished || (S.completed || []).length < 5) return 0;
    const { FAST_MIN, SLOW_MIN } = CONFIG.SPEED, m = activeMin(S);
    return Math.max(0, Math.min(1, (SLOW_MIN - m) / (SLOW_MIN - FAST_MIN)));
  }
  function score(S) {
    const P = CONFIG.POINTS;
    let pts = 0;
    for (const id of ["t1", "t2", "t3", "t4", "t5"]) {
      if (!((S.parts || {})[id] || {}).report) continue;
      pts += P.TICKET + (((S.errorsByRoom || {})[id] || 0) === 0 ? P.CLEAN : 0);
    }
    pts -= P.WRONG * (S.totalErrors || 0) + P.HINT * (S.hintsUsed || 0);
    pts += Math.round(P.SPEED * speedFactor(S));
    return pts;
  }
  function grade(S, TK) {
    const G = CONFIG.GRADE;
    const per = TK.map((t) => {
      const P = (S.parts || {})[t.id] || {};
      const hints = (S.hintsByRoom || {})[t.id] || 0, wrong = (S.errorsByRoom || {})[t.id] || 0;
      let pts = 0, estado = "Sin resolver";
      if (P.report) { pts = Math.max(G.MIN_CLOSED, G.TICKET - G.HINT * hints - G.WRONG * wrong); estado = "Cerrado"; }
      else if (P.verified) { pts = G.VERIFIED_ONLY; estado = "Corregido, sin parte"; }
      return { id: t.id, title: t.title, estado, hints, wrong, pts: Math.round(pts * 100) / 100 };
    });
    const sp = Math.round(G.SPEED * speedFactor(S) * 100) / 100;
    const total = Math.round((per.reduce((a, x) => a + x.pts, 0) + sp) * 100) / 100;
    return { total: Math.min(10, total), per, speed: { pts: sp, minutes: Math.round(activeMin(S)), applies: !!S.finished && (S.completed || []).length >= 5 } };
  }
  const fmtGrade = (n) => String(Math.round(n * 100) / 100).replace(".", ",");

  /* ---------- Ranking automático (Apps Script) ---------- */
  async function rankPayload(S) {
    const d = { code: S.groupCode, name: String(S.team || "").slice(0, 60), score: S.score, tickets: S.completed.length, hints: S.hintsUsed, errors: S.totalErrors, finished: !!S.finished, start: S.startTime };
    const payload = [d.code, d.name, d.score, d.tickets, d.hints, d.errors, d.finished ? 1 : 0, d.start].join("|");
    d.chk = (await sha256(CONFIG.SECRET + "#RANK#" + payload)).slice(0, 16);
    return d;
  }
  async function sendRank(S) {
    if (!CONFIG.RANKING_URL) return "off";
    const body = JSON.stringify(await rankPayload(S));
    try {
      await fetch(CONFIG.RANKING_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body });
      return "ok";
    } catch (e) { return "error"; }
  }
  async function readRank(pin) {
    const r = await fetch(CONFIG.RANKING_URL + "?pin=" + encodeURIComponent(pin) + "&t=" + Date.now());
    return r.json();
  }

  async function makeSave(state) { return JSON.stringify({ app: "codigorojo", state, chk: await sha256(CONFIG.SECRET + "#SAVE#" + JSON.stringify(state)) }); }
  async function readSave(text) {
    try { const o = JSON.parse(text); if (o.app !== "codigorojo" || !o.state) return null; if ((await sha256(CONFIG.SECRET + "#SAVE#" + JSON.stringify(o.state))) !== o.chk) return { tampered: true }; return { state: o.state }; } catch (e) { return null; }
  }
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

  g.CN = { CONFIG, LANS, ROUTERS, SRV_IP, CATS, CMDS, rng, sha256, generateGroupCode, deriveGroup, tickets, baseline, lanOfHost, hostsOf, makeFinishCode, parseFinishCode, makeSave, readSave, fmtTime, sendRank, readRank, rankPayload, grade, fmtGrade, score, activeMin, speedFactor };
})(typeof window !== "undefined" ? window : globalThis);
