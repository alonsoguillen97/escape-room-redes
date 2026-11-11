/* =========================================================
   SIMULADOR DE RED (simplificado, con fines didácticos)
   Modela: interfaces, rutas conectadas/estáticas/RIP, DHCP en router,
   decisión local/remoto del host, ping, tracert, nslookup y una CLI
   Cisco IOS reducida. Las salidas imitan Packet Tracer / Windows.
   ========================================================= */
(function (g) {
  "use strict";

  /* ---------- Utilidades IPv4 ---------- */
  const isIP = (s) => typeof s === "string" && /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split(".").every((o) => +o <= 255);
  const ip2n = (s) => s.split(".").reduce((a, o) => a * 256 + +o, 0) >>> 0;
  const n2ip = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  const pmask = (p) => (p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);
  const prefixOf = (m) => { let n = ip2n(m), c = 0; while (n & 0x80000000) { c++; n = (n << 1) >>> 0; } return c; };
  const validMask = (m) => { if (!isIP(m)) return false; const inv = ~ip2n(m) >>> 0; return ((inv + 1) & inv) === 0; };
  const netN = (ip, m) => (ip2n(ip) & ip2n(m)) >>> 0;
  const sameNet = (a, b, m) => isIP(a) && isIP(b) && validMask(m) && netN(a, m) === netN(b, m);
  const classfulMask = (ip) => { const f = +ip.split(".")[0]; return f < 128 ? "255.0.0.0" : f < 192 ? "255.255.0.0" : "255.255.255.0"; };
  const classfulNet = (ip) => n2ip(netN(ip, classfulMask(ip)));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const hasIP = (h) => h.ip && h.ip !== "0.0.0.0";

  /* ---------- Topología ---------- */
  function upIfaces(R) {
    return Object.entries(R.ifaces).filter(([, i]) => !i.shut && i.ip).map(([name, i]) => ({ name, ...i }));
  }
  function endpointsAt(N, seg, ip) {
    const out = [];
    for (const [name, h] of Object.entries(N.hosts)) if (h.seg === seg && hasIP(h) && h.ip === ip) out.push({ type: "host", name });
    for (const [name, R] of Object.entries(N.routers)) for (const i of upIfaces(R)) if (i.seg === seg && i.ip === ip) out.push({ type: "router", name, iface: i.name });
    return out;
  }

  /* ---------- Tablas de rutas ---------- */
  function computeRoutes(N) {
    const T = {};
    for (const [rn, R] of Object.entries(N.routers)) {
      T[rn] = [];
      for (const i of upIfaces(R)) {
        if (!validMask(i.mask)) continue;
        T[rn].push({ code: "C", net: netN(i.ip, i.mask), prefix: prefixOf(i.mask), iface: i.name, seg: i.seg, ad: 0 });
        T[rn].push({ code: "L", net: ip2n(i.ip), prefix: 32, iface: i.name, seg: i.seg, ad: 0 });
      }
    }
    for (const [rn, R] of Object.entries(N.routers)) {
      for (const s of R.statics || []) {
        const c = T[rn].find((e) => e.code === "C" && ((ip2n(s.nh) & pmask(e.prefix)) >>> 0) === e.net);
        if (c) T[rn].push({ code: "S", net: netN(s.net, s.mask), prefix: prefixOf(s.mask), via: s.nh, iface: c.iface, seg: c.seg, ad: 1, metric: 0 });
      }
    }
    // RIP: se habilita en las interfaces cuya red con clase aparece en "network"
    const ripOn = (R, i) => R.rip && R.rip.on && R.rip.nets.includes(classfulNet(i.ip));
    const learned = {};
    for (const rn of Object.keys(N.routers)) learned[rn] = {};
    for (let round = 0; round < 6; round++) {
      for (const [an, A] of Object.entries(N.routers)) {
        if (!A.rip || !A.rip.on) continue;
        const adv = [];
        for (const i of upIfaces(A)) if (ripOn(A, i) && validMask(i.mask)) adv.push({ net: netN(i.ip, i.mask), prefix: prefixOf(i.mask), metric: 0 });
        for (const [k, r] of Object.entries(learned[an])) adv.push({ net: r.net, prefix: r.prefix, metric: r.metric });
        for (const ia of upIfaces(A)) {
          if (!ripOn(A, ia)) continue;
          for (const [bn, B] of Object.entries(N.routers)) {
            if (bn === an || !B.rip || !B.rip.on) continue;
            for (const ib of upIfaces(B)) {
              if (ib.seg !== ia.seg || !ripOn(B, ib)) continue;
              for (const a of adv) {
                const key = a.net + "/" + a.prefix;
                if (T[bn].some((e) => e.code === "C" && e.net === a.net && e.prefix === a.prefix)) continue;
                const m = a.metric + 1;
                if (m > 15) continue;
                const cur = learned[bn][key];
                if (!cur || m < cur.metric) learned[bn][key] = { net: a.net, prefix: a.prefix, metric: m, via: ia.ip, iface: ib.name, seg: ib.seg };
              }
            }
          }
        }
      }
    }
    for (const [rn, routes] of Object.entries(learned)) {
      for (const r of Object.values(routes)) {
        if (T[rn].some((e) => e.net === r.net && e.prefix === r.prefix && e.ad < 120)) continue;
        T[rn].push({ code: "R", net: r.net, prefix: r.prefix, via: r.via, iface: r.iface, seg: r.seg, ad: 120, metric: r.metric });
      }
    }
    return T;
  }
  function lookup(entries, dst) {
    let best = null;
    for (const e of entries) {
      if (e.code === "L") continue;
      if (((dst & pmask(e.prefix)) >>> 0) !== e.net) continue;
      if (!best || e.prefix > best.prefix || (e.prefix === best.prefix && e.ad < best.ad)) best = e;
    }
    return best;
  }

  /* ---------- Reenvío ---------- */
  function routerFwd(N, T, rn, ingressIp, dst, hops, depth) {
    hops = hops.concat([{ router: rn, ip: ingressIp }]);
    if (depth > 12) return { status: "timeout", hops, why: "loop" };
    const R = N.routers[rn];
    if (upIfaces(R).some((i) => i.ip === dst)) return { status: "ok", hops, dst: { type: "router", name: rn } };
    const e = lookup(T[rn], ip2n(dst));
    if (!e) return { status: "unreach", hops, reporter: { router: rn, ip: ingressIp } };
    if (e.code === "C") {
      const ep = endpointsAt(N, e.seg, dst).filter((x) => !(x.type === "router" && x.name === rn))[0];
      if (!ep) return { status: "timeout", hops, why: "arp" };
      if (ep.type === "host") return { status: "ok", hops, dst: ep, lastSeg: e.seg };
      return { status: "ok", hops: hops.concat([{ router: ep.name, ip: dst }]), dst: ep };
    }
    const nh = endpointsAt(N, e.seg, e.via).find((x) => x.type === "router" && x.name !== rn);
    if (!nh) return { status: "timeout", hops, why: "nexthop" };
    return routerFwd(N, T, nh.name, e.via, dst, hops, depth + 1);
  }
  function fromHost(N, T, hn, dst) {
    const h = N.hosts[hn];
    if (!hasIP(h) || !validMask(h.mask)) return { status: "timeout", hops: [], why: "noip" };
    if (dst === h.ip) return { status: "ok", hops: [], dst: { type: "host", name: hn }, self: true };
    if (sameNet(h.ip, dst, h.mask)) {
      const ep = endpointsAt(N, h.seg, dst)[0];
      if (!ep) return { status: "timeout", hops: [], why: "arp" };
      if (ep.type === "router") return { status: "ok", hops: [{ router: ep.name, ip: dst }], dst: ep };
      return { status: "ok", hops: [], dst: ep, lastSeg: h.seg };
    }
    if (!isIP(h.gw) || !sameNet(h.ip, h.gw, h.mask)) return { status: "timeout", hops: [], why: "nogw" };
    const gw = endpointsAt(N, h.seg, h.gw).find((x) => x.type === "router");
    if (!gw) return { status: "timeout", hops: [], why: "gwdown" };
    return routerFwd(N, T, gw.name, h.gw, dst, [], 0);
  }
  function fromRouter(N, T, rn, dst) {
    const R = N.routers[rn];
    if (upIfaces(R).some((i) => i.ip === dst)) return { status: "ok", hops: [], dst: { type: "router", name: rn } };
    const e = lookup(T[rn], ip2n(dst));
    if (!e) return { status: "unreach", hops: [], reporter: { router: rn, ip: null }, local: true };
    if (e.code === "C") {
      const ep = endpointsAt(N, e.seg, dst).filter((x) => !(x.type === "router" && x.name === rn))[0];
      if (!ep) return { status: "timeout", hops: [], why: "arp" };
      if (ep.type === "host") return { status: "ok", hops: [], dst: ep, lastSeg: e.seg };
      return { status: "ok", hops: [{ router: ep.name, ip: dst }], dst: ep };
    }
    const nh = endpointsAt(N, e.seg, e.via).find((x) => x.type === "router" && x.name !== rn);
    if (!nh) return { status: "timeout", hops: [], why: "nexthop" };
    return routerFwd(N, T, nh.name, e.via, dst, [], 1);
  }
  const reached = (res, node) => res.status === "ok" && res.dst && res.dst.type === node.type && res.dst.name === node.name;
  const replyFrom = (N, T, node, ip) => (node.type === "host" ? fromHost(N, T, node.name, ip) : fromRouter(N, T, node.name, ip));

  /* Ping lógico (devuelve el resultado, sin formato) */
  function probe(N, src, dst, T) {
    T = T || computeRoutes(N);
    const isHost = src.type === "host";
    const srcIp = isHost ? N.hosts[src.name].ip : null;
    const f = isHost ? fromHost(N, T, src.name, dst) : fromRouter(N, T, src.name, dst);
    if (f.status === "ok") {
      if (f.self) return { result: "reply", ttl: 128, fwd: f, back: f };
      // dirección de origen de un router: la de la interfaz de salida (simplificado: primera interfaz en el camino)
      const back = isHost ? replyFrom(N, T, f.dst, srcIp) : routerReplyTo(N, T, f.dst, src.name, dst);
      if (isHost ? reached(back, src) : back) {
        const hopsBack = isHost ? back.hops.length : 0;
        const base = f.dst.type === "host" ? 128 : 255;
        return { result: "reply", ttl: base - hopsBack, fwd: f, back };
      }
      return { result: "timeout", fwd: f, back, lost: "back" };
    }
    if (f.status === "unreach") {
      if (!isHost) return { result: "unreach", by: f.reporter.ip, fwd: f };
      const r = fromRouter(N, T, f.reporter.router, srcIp);
      if (reached(r, src)) return { result: "unreach", by: f.reporter.ip, fwd: f };
      return { result: "timeout", fwd: f, lost: "back" };
    }
    return { result: "timeout", fwd: f, lost: "fwd" };
  }
  // Para pings desde router: el destino debe poder volver a alguna IP del router de origen
  function routerReplyTo(N, T, node, rn) {
    for (const i of upIfaces(N.routers[rn])) {
      const b = replyFrom(N, T, node, i.ip);
      if (reached(b, { type: "router", name: rn })) return b;
    }
    return null;
  }

  /* ---------- DNS ---------- */
  function resolve(N, hn, name, T) {
    const h = N.hosts[hn];
    if (!isIP(h.dns)) return { ok: false, why: "nodns" };
    const p = probe(N, { type: "host", name: hn }, h.dns, T);
    if (p.result !== "reply" || p.fwd.dst.type !== "host" || !N.hosts[p.fwd.dst.name].dnsServer) return { ok: false, why: "timeout", server: h.dns };
    const ip = N.dns[name.toLowerCase()];
    if (!ip) return { ok: false, why: "nxdomain", server: h.dns };
    return { ok: true, ip, server: h.dns };
  }

  /* ---------- DHCP en router ---------- */
  const fmtMac = (m) => m;
  function dhcpRequest(N, hn) {
    const h = N.hosts[hn];
    for (const [rn, R] of Object.entries(N.routers)) {
      for (const i of upIfaces(R)) {
        if (i.seg !== h.seg || !validMask(i.mask)) continue;
        const pool = (R.dhcp.pools || []).find((p) => isIP(p.network) && validMask(p.mask) && netN(p.network, p.mask) === netN(i.ip, i.mask));
        if (!pool) continue;
        const net = netN(pool.network, pool.mask), bc = (net | (~ip2n(pool.mask) >>> 0)) >>> 0;
        const excluded = (n) => (R.dhcp.excluded || []).some(([a, b]) => n >= ip2n(a) && n <= ip2n(b || a));
        const used = new Set();
        for (const r2 of Object.values(N.routers)) for (const j of upIfaces(r2)) used.add(ip2n(j.ip));
        for (const [on, o] of Object.entries(N.hosts)) if (on !== hn && hasIP(o) && o.seg === h.seg) used.add(ip2n(o.ip));
        R.leases = (R.leases || []).filter((l) => l.mac !== h.mac || true);
        const mine = R.leases.find((l) => l.mac === h.mac);
        const free = (n) => n > net && n < bc && !excluded(n) && !used.has(n) && !R.leases.some((l) => l.mac !== h.mac && ip2n(l.ip) === n);
        let pick = mine && free(ip2n(mine.ip)) ? ip2n(mine.ip) : null;
        if (pick === null) for (let n = net + 1; n < bc; n++) if (free(n)) { pick = n; break; }
        if (pick === null) continue;
        R.leases = R.leases.filter((l) => l.mac !== h.mac);
        R.leases.push({ ip: n2ip(pick), mac: h.mac });
        Object.assign(h, { ip: n2ip(pick), mask: pool.mask, gw: pool.router || "", dns: pool.dns || "", dhcpServer: i.ip });
        return true;
      }
    }
    const parts = h.mac.replace(/\./g, "");
    Object.assign(h, { ip: `169.254.${parseInt(parts.slice(8, 10), 16)}.${parseInt(parts.slice(10, 12), 16) || 1}`, mask: "255.255.0.0", gw: "", dns: "", dhcpServer: "" });
    return false;
  }

  /* ---------- Salidas tipo Windows / Packet Tracer ---------- */
  function linkLocal(mac) {
    const b = mac.replace(/\./g, "").match(/../g).map((x) => parseInt(x, 16));
    b[0] ^= 2;
    const w = [(b[0] << 8) | b[1], (b[2] << 8) | 0xff, (0xfe << 8) | b[3], (b[4] << 8) | b[5]];
    return "FE80::" + w.map((x) => x.toString(16).toUpperCase()).join(":");
  }
  function pcIpconfig(N, hn, all) {
    const h = N.hosts[hn];
    const ip = hasIP(h) ? h.ip : "0.0.0.0", mask = hasIP(h) ? h.mask : "0.0.0.0";
    let s = `\nFastEthernet0 Connection:(default port)\n\n   Connection-specific DNS Suffix..: \n`;
    if (all) s += `   Physical Address................: ${fmtMac(h.mac)}\n`;
    s += `   Link-local IPv6 Address.........: ${linkLocal(h.mac)}\n   IPv6 Address....................: ::\n`;
    s += `   IPv4 Address....................: ${ip}\n   Subnet Mask.....................: ${mask}\n   Default Gateway.................: ::\n                                     ${h.gw || "0.0.0.0"}\n`;
    if (all) s += `   DHCP Servers....................: ${h.dhcp && h.dhcpServer ? h.dhcpServer : "0.0.0.0"}\n   DHCPv6 IAID.....................: \n   DHCPv6 Client DUID..............: 00-01-00-01-${h.mac.replace(/\./g, "").match(/../g).join("-")}\n   DNS Servers.....................: ::\n                                     ${h.dns || "0.0.0.0"}\n`;
    return s;
  }
  function pcRenewOut(N, hn) {
    const h = N.hosts[hn];
    return `\n   IP Address......................: ${hasIP(h) ? h.ip : "0.0.0.0"}\n   Subnet Mask.....................: ${hasIP(h) ? h.mask : "0.0.0.0"}\n   Default Gateway.................: ${h.gw || "0.0.0.0"}\n   DNS Server......................: ${h.dns || "0.0.0.0"}\n`;
  }
  function pcPing(N, hn, target) {
    const T = computeRoutes(N);
    let ip = target, head = "";
    if (!isIP(target)) {
      const r = resolve(N, hn, target, T);
      if (!r.ok) return { text: `Ping request could not find host ${target}. Please check the name and try again.\n`, ok: false, byName: true };
      ip = r.ip; head = `${target} [${ip}]`;
    }
    const p = probe(N, { type: "host", name: hn }, ip, T);
    const lines = [`\nPinging ${head || ip} with 32 bytes of data:\n`];
    let rec = 0;
    for (let k = 0; k < 4; k++) {
      if (p.result === "reply") { lines.push(`Reply from ${ip}: bytes=32 time<1ms TTL=${p.ttl}`); rec++; }
      else if (p.result === "unreach") { lines.push(`Reply from ${p.by}: Destination host unreachable.`); }
      else lines.push("Request timed out.");
    }
    const lost = 4 - rec;
    lines.push(`\nPing statistics for ${ip}:\n    Packets: Sent = 4, Received = ${p.result === "unreach" ? 4 : rec}, Lost = ${p.result === "unreach" ? 0 : lost} (${p.result === "unreach" ? 0 : lost * 25}% loss),`);
    if (p.result === "reply") lines.push(`Approximate round trip times in milli-seconds:\n    Minimum = 0ms, Maximum = 1ms, Average = 0ms`);
    return { text: lines.join("\n") + "\n", ok: p.result === "reply", probe: p, ip, byName: !isIP(target) };
  }
  function pcTracert(N, hn, target) {
    const T = computeRoutes(N);
    let ip = target;
    if (!isIP(target)) {
      const r = resolve(N, hn, target, T);
      if (!r.ok) return { text: `Unable to resolve target system name ${target}.\n`, ok: false };
      ip = r.ip;
    }
    const h = N.hosts[hn], src = { type: "host", name: hn };
    const f = fromHost(N, T, hn, ip);
    const L = [`\nTracing route to ${ip} over a maximum of 30 hops: \n`];
    const ok = (n, a) => L.push(`  ${String(n).padEnd(3)} 0 ms      0 ms      0 ms      ${a}`);
    const to = (n) => L.push(`  ${String(n).padEnd(3)} *         *         *         Request timed out.`);
    let n = 1, done = false;
    const hops = f.hops || [];
    const finalIsRouter = f.status === "ok" && f.dst.type === "router";
    for (let k = 0; k < hops.length; k++) {
      const last = k === hops.length - 1;
      if (last && finalIsRouter) break;
      const back = hasIP(h) ? fromRouter(N, T, hops[k].router, h.ip) : { status: "timeout" };
      reached(back, src) ? ok(n, hops[k].ip) : to(n);
      n++;
    }
    if (f.status === "ok") {
      const back = replyFrom(N, T, f.dst, h.ip);
      if (reached(back, src)) { ok(n, ip); done = true; }
    } else if (f.status === "unreach") {
      const back = fromRouter(N, T, f.reporter.router, h.ip);
      if (reached(back, src)) { L.push(`  ${String(n).padEnd(3)} ${f.reporter.ip}  reports: Destination host unreachable.`); done = true; }
    }
    if (!done) for (; n <= 30; n++) to(n);
    L.push("\nTrace complete.");
    return { text: L.join("\n") + "\n", ok: f.status === "ok" && done, fwd: f, ip };
  }
  function pcNslookup(N, hn, name) {
    if (!name) return { text: "Uso: nslookup <nombre>\n", ok: false };
    const h = N.hosts[hn];
    const r = resolve(N, hn, name);
    const head = `Server: [${h.dns || "0.0.0.0"}]\nAddress:  ${h.dns || "0.0.0.0"}\n\n`;
    const to = "DNS request timed out.\n    timeout was 15000 milli seconds.\n";
    if (r.why === "nodns" || r.why === "timeout") return { text: head + to + to + `*** UnKnown can't find ${name}: No response from server\n`, ok: false };
    if (r.why === "nxdomain") return { text: head + `*** Server can't find ${name}: Non-existent domain\n`, ok: false };
    return { text: head + `Non-authoritative answer:\nName:\t${name.toLowerCase()}\nAddress:\t${r.ip}\n`, ok: true, ip: r.ip };
  }

  /* ---------- Salidas Cisco IOS ---------- */
  const IF_SHORT = (n) => n;
  function iosIntBrief(R) {
    let s = "Interface              IP-Address      OK? Method Status                Protocol \n";
    for (const [name, i] of Object.entries(R.ifaces)) {
      const st = i.shut ? "administratively down" : "up";
      const pr = i.shut ? "down" : "up";
      s += `${name.padEnd(23)}${(i.ip || "unassigned").padEnd(16)}YES ${(i.ip ? "manual" : "unset").padEnd(7)}${st.padEnd(22)}${pr} \n`;
    }
    s += `${"Vlan1".padEnd(23)}${"unassigned".padEnd(16)}YES unset  administratively down down\n`;
    return s;
  }
  function iosRoute(N, rn) {
    const T = computeRoutes(N)[rn];
    let s = `Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP
       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area
       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2
       E1 - OSPF external type 1, E2 - OSPF external type 2, E - EGP
       i - IS-IS, L1 - IS-IS level-1, L2 - IS-IS level-2, ia - IS-IS inter area
       * - candidate default, U - per-user static route, o - ODR
       P - periodic downloaded static route

Gateway of last resort is not set

`;
    const groups = {};
    for (const e of T) { const major = classfulNet(n2ip(e.net)); (groups[major] = groups[major] || []).push(e); }
    const order = Object.keys(groups).sort((a, b) => ip2n(a) - ip2n(b));
    for (const major of order) {
      const es = groups[major].sort((a, b) => a.net - b.net || a.prefix - b.prefix);
      const cp = prefixOf(classfulMask(major));
      const masks = new Set(es.map((e) => e.prefix));
      if (es.length > 1 || es[0].prefix !== cp) {
        s += masks.size > 1 ? `     ${major}/${cp} is variably subnetted, ${es.length} subnets, ${masks.size} masks\n` : `     ${major}/${es[0].prefix} is subnetted, ${es.length} subnets\n`;
      }
      for (const e of es) {
        const dest = `${n2ip(e.net)}/${e.prefix}`;
        const pad = e.code.padEnd(8);
        if (e.code === "C" || e.code === "L") s += `${pad}${dest} is directly connected, ${e.iface}\n`;
        else if (e.code === "S") s += `${pad}${dest} [1/0] via ${e.via}\n`;
        else s += `${pad}${dest} [120/${e.metric}] via ${e.via}, 00:00:${String(10 + (e.net % 19)).padStart(2, "0")}, ${e.iface}\n`;
      }
    }
    return s;
  }
  function iosProtocols(N, rn) {
    const R = N.routers[rn];
    if (!R.rip || !R.rip.on) return "";
    const ifs = upIfaces(R).filter((i) => R.rip.nets.includes(classfulNet(i.ip)));
    return `\nRouting Protocol is "rip"\nSending updates every 30 seconds, next due in 12 seconds\nInvalid after 180 seconds, hold down 180, flushed after 240\nOutgoing update filter list for all interfaces is not set\nIncoming update filter list for all interfaces is not set\nRedistributing: rip\nDefault version control: send version ${R.rip.version}, receive ${R.rip.version === 2 ? "2" : "any version"}\n  Interface             Send  Recv  Triggered RIP  Key-chain\n${ifs.map((i) => `  ${i.name.padEnd(22)}${R.rip.version}     ${R.rip.version}`).join("\n")}\nAutomatic network summarization is ${R.rip.noAuto ? "not " : ""}in effect\nMaximum path: 4\nRouting for Networks:\n${R.rip.nets.map((n) => "\t" + n).join("\n")}\nPassive Interface(s):\nRouting Information Sources:\n\tGateway         Distance      Last Update\nDistance: (default is 120)\n`;
  }
  function iosDhcpBinding(N, rn) {
    const R = N.routers[rn];
    let s = "IP address       Client-ID/              Lease expiration        Type\n                 Hardware address\n";
    for (const l of R.leases || []) s += `${l.ip.padEnd(17)}${l.mac.padEnd(24)} --                     Automatic\n`;
    return s;
  }
  function iosRunning(N, rn) {
    const R = N.routers[rn];
    let s = `Building configuration...\n\nCurrent configuration : ${900 + Object.keys(R.ifaces).length * 80} bytes\n!\nversion 15.1\nno service timestamps log datetime msec\nno service timestamps debug datetime msec\nno service password-encryption\n!\nhostname ${rn}\n!\n`;
    for (const [a, b] of R.dhcp.excluded || []) s += `ip dhcp excluded-address ${a}${b && b !== a ? " " + b : ""}\n`;
    if ((R.dhcp.excluded || []).length) s += "!\n";
    for (const p of R.dhcp.pools || []) {
      s += `ip dhcp pool ${p.name}\n`;
      if (p.network) s += ` network ${p.network} ${p.mask}\n`;
      if (p.router) s += ` default-router ${p.router}\n`;
      if (p.dns) s += ` dns-server ${p.dns}\n`;
      s += "!\n";
    }
    s += "!\nip cef\nno ipv6 cef\n!\n";
    for (const [name, i] of Object.entries(R.ifaces)) {
      s += `interface ${name}\n`;
      s += i.ip ? ` ip address ${i.ip} ${i.mask}\n` : " no ip address\n";
      s += " duplex auto\n speed auto\n";
      if (i.shut) s += " shutdown\n";
      s += "!\n";
    }
    s += "interface Vlan1\n no ip address\n shutdown\n!\n";
    if (R.rip && R.rip.on) {
      s += "router rip\n";
      if (R.rip.version === 2) s += " version 2\n";
      for (const n of R.rip.nets) s += ` network ${n}\n`;
      if (R.rip.noAuto) s += " no auto-summary\n";
      s += "!\n";
    }
    s += "ip classless\n";
    for (const st of R.statics || []) s += `ip route ${st.net} ${st.mask} ${st.nh}\n`;
    s += "!\nip flow-export version 9\n!\nline con 0\n!\nline aux 0\n!\nline vty 0 4\n login\n!\nend\n";
    return s;
  }
  function iosPing(N, rn, ip) {
    const p = probe(N, { type: "router", name: rn }, ip);
    const ch = p.result === "reply" ? "!" : p.result === "unreach" ? "U" : ".";
    const marks = p.result === "unreach" ? "U.U.U" : ch.repeat(5);
    const okN = p.result === "reply" ? 5 : 0;
    return { text: `Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:\n${marks}\nSuccess rate is ${okN * 20} percent (${okN}/5)${okN ? ", round-trip min/avg/max = 0/0/1 ms" : ""}\n`, ok: okN > 0, probe: p };
  }

  /* ---------- CLI Cisco IOS reducida ---------- */
  const MODES = { user: ">", priv: "#", config: "(config)#", if: "(config-if)#", router: "(config-router)#", dhcp: "(dhcp-config)#" };
  function prompt(rn, sess) { return rn + MODES[sess.mode]; }
  function kw(tok, list) {
    if (!tok) return null;
    tok = tok.toLowerCase();
    if (list.includes(tok)) return tok;
    const c = list.filter((k) => k.startsWith(tok));
    return c.length === 1 ? c[0] : c.length > 1 ? "__amb" : null;
  }
  function parseIf(tokens) {
    const s = tokens.join("").toLowerCase();
    const m = s.match(/^([a-z]+)(\d\/\d+)$/);
    if (!m) return null;
    if ("gigabitethernet".startsWith(m[1])) return "GigabitEthernet" + m[2];
    return null;
  }
  function invalid(promptStr, line, tokIdx, tokens) {
    let pos = 0, rest = line;
    for (let k = 0; k < tokIdx; k++) { const at = rest.indexOf(tokens[k]); pos += at + tokens[k].length; rest = rest.slice(at + tokens[k].length); }
    pos += rest.length - rest.trimStart().length;
    return " ".repeat(promptStr.length + pos) + "^\n% Invalid input detected at '^' marker.\n";
  }
  const HELP = {
    user: "  enable      Turn on privileged commands\n  ping        Send echo messages\n  show        Show running system information\n  exit        Exit from the EXEC\n",
    priv: "  configure   Enter configuration mode\n  disable     Turn off privileged commands\n  ping        Send echo messages\n  show        Show running system information\n  exit        Exit from the EXEC\n",
    config: "  interface   Select an interface to configure\n  ip          Global IP configuration subcommands (route, dhcp)\n  no          Negate a command or set its defaults\n  router      Enable a routing process\n  do          To run exec commands in config mode\n  end         Exit from configure mode\n  exit        Exit from configure mode\n",
    if: "  ip          Interface Internet Protocol config commands\n  no          Negate a command or set its defaults\n  shutdown    Shutdown the selected interface\n  exit        Exit from interface configuration mode\n  end         Exit to privileged mode\n",
    router: "  network     Enable routing on an IP network\n  no          Negate a command or set its defaults\n  version     Set routing protocol version\n  exit        Exit from routing protocol configuration mode\n",
    dhcp: "  default-router  Default routers\n  dns-server      DNS servers\n  network         Network number and mask\n  no              Negate a command or set its defaults\n  exit            Exit from DHCP pool configuration mode\n",
  };

  /* Ejecuta una línea en la CLI. Devuelve {out, changed, change, event} */
  function ios(N, rn, sess, line) {
    const R = N.routers[rn];
    const p = prompt(rn, sess);
    const raw = line.trim();
    if (!raw) return { out: "" };
    const t = raw.split(/\s+/);
    const res = { out: "" };
    const inv = (k) => ({ out: invalid(p, line, k, t) });
    if (raw === "?") return { out: HELP[sess.mode] };

    // ---- modos EXEC ----
    if (sess.mode === "user" || sess.mode === "priv") return exec(N, rn, sess, t, line, p, inv);

    // "do" en modos de configuración
    if (t[0].toLowerCase() === "do") {
      const sub = t.slice(1);
      if (!sub.length) return { out: "% Incomplete command.\n" };
      const r = exec(N, rn, { mode: "priv" }, sub, sub.join(" "), p, () => ({ out: "% Invalid input detected.\n" }));
      return r;
    }
    const k0 = kw(t[0], ["end", "exit", "no", "interface", "router", "ip", "shutdown", "network", "version", "default-router", "dns-server"]);
    if (k0 === "end") { sess.mode = "priv"; return { out: "\n%SYS-5-CONFIG_I: Configured from console by console\n" }; }
    if (k0 === "exit") { sess.mode = sess.mode === "config" ? "priv" : "config"; return { out: "" }; }

    // ---- submodo interfaz ----
    if (sess.mode === "if") {
      const I = R.ifaces[sess.iface];
      const neg = k0 === "no";
      const a = kw(neg ? t[1] : t[0], ["shutdown", "ip"]);
      if (a === "shutdown") {
        I.shut = !neg;
        const st = I.shut ? "administratively down" : "up";
        return { out: `\n%LINK-5-CHANGED: Interface ${sess.iface}, changed state to ${st}\n${I.shut ? "" : `\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ${sess.iface}, changed state to up\n`}`, changed: true, change: `${sess.iface}: ${neg ? "no shutdown" : "shutdown"}` };
      }
      const b = a === "ip" ? kw(neg ? t[2] : t[1], ["address"]) : null;
      if (a === "ip" && b === "address") {
        if (neg) { I.ip = ""; I.mask = ""; return { out: "", changed: true, change: `${sess.iface}: no ip address` }; }
        const ip = t[2], m = t[3];
        if (!isIP(ip)) return inv(2);
        if (!validMask(m)) return m ? { out: "Bad mask /" + prefixOf(m || "0.0.0.0") + " for address " + ip + "\n" } : { out: "% Incomplete command.\n" };
        I.ip = ip; I.mask = m;
        return { out: "", changed: true, change: `${sess.iface}: ip address ${ip} ${m}` };
      }
    }
    // ---- submodo router rip ----
    if (sess.mode === "router") {
      const neg = k0 === "no";
      const a = kw(neg ? t[1] : t[0], ["network", "version"]);
      if (a === "network") {
        const ip = neg ? t[2] : t[1];
        if (!isIP(ip)) return ip ? inv(neg ? 2 : 1) : { out: "% Incomplete command.\n" };
        const cn = classfulNet(ip);
        if (neg) { R.rip.nets = R.rip.nets.filter((x) => x !== cn); return { out: "", changed: true, change: `router rip: no network ${cn}` }; }
        if (!R.rip.nets.includes(cn)) R.rip.nets.push(cn);
        return { out: "", changed: true, change: `router rip: network ${cn}` };
      }
      if (a === "version") { const v = t[1] === "1" ? 1 : 2; R.rip.version = v; return { out: "", changed: true, change: `router rip: version ${v}` }; }
      if (kw(neg ? t[1] : t[0], ["auto-summary"]) === "auto-summary") { R.rip.noAuto = neg; return { out: "", changed: true, change: `router rip: ${neg ? "no " : ""}auto-summary` }; }
    }
    // ---- submodo pool DHCP ----
    if (sess.mode === "dhcp") {
      const P = R.dhcp.pools.find((x) => x.name === sess.pool);
      const neg = k0 === "no";
      const a = kw(neg ? t[1] : t[0], ["network", "default-router", "dns-server"]);
      const val = neg ? null : t[1];
      if (a === "default-router") { if (!neg && !isIP(val)) return val ? inv(1) : { out: "% Incomplete command.\n" }; P.router = neg ? "" : val; return { out: "", changed: true, change: `pool ${P.name}: ${neg ? "no " : ""}default-router${neg ? "" : " " + val}` }; }
      if (a === "dns-server") { if (!neg && !isIP(val)) return val ? inv(1) : { out: "% Incomplete command.\n" }; P.dns = neg ? "" : val; return { out: "", changed: true, change: `pool ${P.name}: ${neg ? "no " : ""}dns-server${neg ? "" : " " + val}` }; }
      if (a === "network") { if (neg) { P.network = ""; P.mask = ""; return { out: "", changed: true, change: `pool ${P.name}: no network` }; } if (!isIP(t[1]) || !validMask(t[2])) return inv(isIP(t[1]) ? 2 : 1); P.network = t[1]; P.mask = t[2]; return { out: "", changed: true, change: `pool ${P.name}: network ${t[1]} ${t[2]}` }; }
    }
    // ---- comandos de configuración global (también válidos desde submodos) ----
    return globalConfig(N, rn, sess, t, line, p, inv, k0);
  }

  function globalConfig(N, rn, sess, t, line, p, inv, k0) {
    const R = N.routers[rn];
    if (k0 === "interface") {
      const name = parseIf(t.slice(1));
      if (!name || !R.ifaces[name]) return t.length > 1 ? inv(1) : { out: "% Incomplete command.\n" };
      sess.mode = "if"; sess.iface = name; return { out: "" };
    }
    if (k0 === "router") {
      if (kw(t[1], ["rip"]) !== "rip") return t[1] ? inv(1) : { out: "% Incomplete command.\n" };
      R.rip = R.rip || { on: true, version: 1, nets: [] };
      const was = R.rip.on; R.rip.on = true; sess.mode = "router";
      return { out: "", changed: !was, change: !was ? "router rip" : undefined };
    }
    const neg = k0 === "no";
    const off = neg ? 1 : 0;
    if (k0 === "ip" || (neg && kw(t[1], ["ip"]) === "ip")) {
      const a = kw(t[off + 1], ["route", "dhcp"]);
      if (a === "route") {
        const [n, m, nh] = t.slice(off + 2);
        if (!isIP(n)) return n ? inv(off + 2) : { out: "% Incomplete command.\n" };
        if (!validMask(m)) return m ? inv(off + 3) : { out: "% Incomplete command.\n" };
        if (!isIP(nh)) return nh ? inv(off + 4) : { out: "% Incomplete command.\n" };
        const netS = n2ip(netN(n, m));
        if (neg) {
          const before = R.statics.length;
          R.statics = R.statics.filter((s) => !(s.net === netS && s.mask === m && s.nh === nh));
          return before === R.statics.length ? { out: "%No matching route to delete\n" } : { out: "", changed: true, change: `no ip route ${netS} ${m} ${nh}` };
        }
        if (n !== netS) return { out: "%Inconsistent address and mask\n" };
        if (!R.statics.some((s) => s.net === netS && s.mask === m && s.nh === nh)) R.statics.push({ net: netS, mask: m, nh });
        return { out: "", changed: true, change: `ip route ${netS} ${m} ${nh}` };
      }
      if (a === "dhcp") {
        const b = kw(t[off + 2], ["pool", "excluded-address"]);
        if (b === "pool" && !neg) {
          const name = t[off + 3];
          if (!name) return { out: "% Incomplete command.\n" };
          if (!R.dhcp.pools.some((x) => x.name === name)) R.dhcp.pools.push({ name, network: "", mask: "", router: "", dns: "" });
          sess.mode = "dhcp"; sess.pool = name; return { out: "" };
        }
        if (b === "pool" && neg) {
          const name = t[off + 3];
          R.dhcp.pools = R.dhcp.pools.filter((x) => x.name !== name);
          return { out: "", changed: true, change: `no ip dhcp pool ${name}` };
        }
        if (b === "excluded-address") {
          const a1 = t[off + 3], a2 = t[off + 4];
          if (!isIP(a1)) return a1 ? inv(off + 3) : { out: "% Incomplete command.\n" };
          if (a2 && !isIP(a2)) return inv(off + 4);
          if (neg) {
            const before = R.dhcp.excluded.length;
            R.dhcp.excluded = R.dhcp.excluded.filter(([x, y]) => !(x === a1 && (y || x) === (a2 || a1)));
            return before === R.dhcp.excluded.length ? { out: "% Range [" + a1 + ", " + (a2 || a1) + "] is not in the database.\n" } : { out: "", changed: true, change: `no ip dhcp excluded-address ${a1}${a2 ? " " + a2 : ""}` };
          }
          R.dhcp.excluded.push([a1, a2 || a1]);
          return { out: "", changed: true, change: `ip dhcp excluded-address ${a1}${a2 ? " " + a2 : ""}` };
        }
        return t[off + 2] ? inv(off + 2) : { out: "% Incomplete command.\n" };
      }
      return t[off + 1] ? inv(off + 1) : { out: "% Incomplete command.\n" };
    }
    if (k0 === "__amb") return { out: `% Ambiguous command: "${t[0]}"\n` };
    return inv(0);
  }

  function exec(N, rn, sess, t, line, p, inv) {
    const R = N.routers[rn];
    const k0 = kw(t[0], sess.mode === "user" ? ["enable", "exit", "logout", "ping", "show", "traceroute"] : ["configure", "copy", "disable", "enable", "exit", "logout", "ping", "show", "traceroute", "write"]);
    if (k0 === "write" || k0 === "copy") return { out: k0 === "copy" ? "Destination filename [startup-config]? \nBuilding configuration...\n[OK]\n" : "Building configuration...\n[OK]\n" };
    if (k0 === "__amb") return { out: `% Ambiguous command: "${t[0]}"\n` };
    if (k0 === "enable") { sess.mode = "priv"; return { out: "" }; }
    if (k0 === "disable") { sess.mode = "user"; return { out: "" }; }
    if (k0 === "exit" || k0 === "logout") { sess.mode = "user"; return { out: `\n${rn} con0 is now available\n\nPress RETURN to get started.\n` }; }
    if (k0 === "configure") {
      if (t[1] && kw(t[1], ["terminal"]) !== "terminal") return inv(1);
      sess.mode = "config"; return { out: "Enter configuration commands, one per line.  End with CNTL/Z.\n" };
    }
    if (k0 === "ping") {
      if (!isIP(t[1])) return t[1] ? { out: `% Unrecognized host or address, or protocol not running.\n` } : { out: "% Incomplete command.\n" };
      const r = iosPing(N, rn, t[1]);
      return { out: r.text, event: { kind: "ping", from: rn, dst: t[1], ok: r.ok, router: true } };
    }
    if (k0 === "traceroute") return { out: "% Usa tracert desde los PC (en esta simulación).\n" };
    if (k0 === "show") {
      const a = kw(t[1], sess.mode === "user" ? ["ip"] : ["ip", "running-config"]);
      if (a === "running-config") return { out: iosRunning(N, rn), event: { kind: "show", cmd: "show running-config", from: rn } };
      if (a === "ip") {
        const b = kw(t[2], ["interface", "route", "dhcp", "protocols"]);
        if (b === "protocols") return { out: iosProtocols(N, rn), event: { kind: "show", cmd: "show ip protocols", from: rn } };
        if (b === "interface") {
          if (kw(t[3], ["brief"]) !== "brief") return t[3] ? inv(3) : { out: "% Usa: show ip interface brief\n" };
          return { out: iosIntBrief(R), event: { kind: "show", cmd: "show ip interface brief", from: rn } };
        }
        if (b === "route") { if (t[3]) return inv(3); return { out: iosRoute(N, rn), event: { kind: "show", cmd: "show ip route", from: rn } }; }
        if (b === "dhcp") {
          if (kw(t[3], ["binding"]) !== "binding") return t[3] ? inv(3) : { out: "% Incomplete command.\n" };
          return { out: iosDhcpBinding(N, rn), event: { kind: "show", cmd: "show ip dhcp binding", from: rn } };
        }
        return t[2] ? inv(2) : { out: "% Incomplete command.\n" };
      }
      return t[1] ? inv(1) : { out: "% Incomplete command.\n" };
    }
    return inv(0);
  }

  /* ---------- Comprobación global de salud ---------- */
  function health(N) {
    const T = computeRoutes(N);
    const hosts = Object.keys(N.hosts);
    const fails = [];
    for (const a of hosts) for (const b of hosts) {
      if (a === b) continue;
      const p = probe(N, { type: "host", name: a }, N.hosts[b].ip, T);
      if (p.result !== "reply") fails.push(`${a}→${b}`);
    }
    for (const a of hosts) if (!N.hosts[a].dnsServer && !resolve(N, a, "intranet.cited.local", T).ok) fails.push(`${a} DNS`);
    return { ok: fails.length === 0, fails };
  }

  g.NET = { isIP, ip2n, n2ip, validMask, sameNet, netN, prefixOf, classfulNet, clone, computeRoutes, probe, resolve, dhcpRequest, pcIpconfig, pcRenewOut, pcPing, pcTracert, pcNslookup, ios, prompt, health, upIfaces, fromHost };
})(typeof window !== "undefined" ? window : globalThis);
