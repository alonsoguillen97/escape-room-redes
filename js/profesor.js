/* Panel del profesor · Código Rojo en la Red */
(function () {
  "use strict";
  const KEY = "codigorojo.ranking.v1";
  const root = document.getElementById("t");
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) {}
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} };

  function gate() {
    if (sessionStorage.getItem("cr-prof") === "1") return main();
    root.innerHTML = `<div class="card gate"><span class="eyebrow">PANEL DEL PROFESOR</span><h2>Código Rojo en la Red</h2><form id="g"><label><span>PIN</span><input id="pin" type="password" autocomplete="off"></label><br><button class="btn" type="submit">Entrar</button></form></div>`;
    $("#g").onsubmit = (e) => { e.preventDefault(); if ($("#pin").value === CN.CONFIG.TEACHER_PIN) { sessionStorage.setItem("cr-prof", "1"); main(); } else $("#pin").classList.add("shake"); };
  }
  function main() {
    root.innerHTML = `<span class="eyebrow">PANEL DEL PROFESOR · 1º ASIR</span><h1>CÓDIGO <span class="hl">ROJO</span> EN LA RED</h1>
      <div class="tabs" role="tablist"><button class="btn" role="tab" data-tab="rank" aria-selected="true">🏆 Ranking</button><button class="btn" role="tab" data-tab="sol" aria-selected="false">🔎 Solucionario</button></div>
      <section class="card panel" id="view"></section>`;
    root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { root.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b))); b.dataset.tab === "rank" ? rank() : sol(); }));
    rank();
  }
  const sorted = () => list.slice().sort((a, b) => (b.valid - a.valid) || (b.score - a.score) || (a.end - b.end));
  function rank() {
    const v = $("#view"), s = sorted().filter((x) => x.valid), pod = [s[1], s[0], s[2]];
    v.innerHTML = `<h2>Ranking por puntos</h2><p class="muted small">Pega los códigos de finalización (empiezan por <code>CR.</code>), uno por línea. Empate: gana quien terminó antes.</p>
      <textarea id="codes" placeholder="CR.xxxxx.XXXXXXXX"></textarea>
      <div class="toolbar"><button class="btn" id="add">Añadir códigos</button><button class="btn ghost" id="clr">Vaciar ranking</button></div>
      ${s.length ? `<div class="podium">${pod.map((x, i) => (x ? `<div class="pod p${[2, 1, 3][i]}"><div class="bar">${[2, 1, 3][i]}</div><b>${esc(x.team)}</b><span>${x.score} pts</span></div>` : "<div></div>")).join("")}</div>` : ""}
      <table><thead><tr><th>#</th><th>Equipo</th><th>Código</th><th>Puntos</th><th>Terminó</th><th>Pistas</th><th>Partes erróneos</th><th></th></tr></thead><tbody>
      ${sorted().map((x, i) => `<tr class="${x.valid ? "" : "invalid"}"><td>${x.valid ? i + 1 : "✗"}</td><td>${esc(x.team)}</td><td class="mono">${esc(x.group)}</td><td>${x.score}</td><td class="mono">${new Date(x.end).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td><td>${x.hints}</td><td>${x.errors}</td><td>${x.valid ? "✓" : "Código manipulado"}</td></tr>`).join("") || `<tr><td colspan="8">Aún no hay equipos.</td></tr>`}
      </tbody></table>`;
    $("#add").onclick = async () => {
      const lines = $("#codes").value.split(/\s+/).filter(Boolean); let added = 0;
      for (const l of lines) { const r = await CN.parseFinishCode(l); if (!r) continue; list = list.filter((x) => x.group !== r.group); list.push(r); added++; }
      persist(); rank(); if (!added && lines.length) alert("Ningún código reconocido.");
    };
    $("#clr").onclick = () => { if (confirm("¿Vaciar el ranking?")) { list = []; persist(); rank(); } };
  }
  function faultText(t, d) {
    const L = CN.LANS;
    switch (t.id) {
      case "t1": return `En ${d.t1.router}: interface GigabitEthernet0/0 → shutdown`;
      case "t2": return `En ${CN.LANS[d.t2.router].short}-2: IP estática ${L[d.t2.router].net}.${d.t2.host} con máscara ${d.t2.variant === "25" ? "255.255.255.128" : "255.255.0.0"}, gateway ${L[d.t2.router].net}.1`;
      case "t3": return d.t3.variant === "gw" ? `En ${d.t3.router}: ip dhcp pool ${L[d.t3.router].pool} → default-router ${d.t3.wrongGw} (y renovar ${L[d.t3.router].short}-2)` : `En ${d.t3.router}: ip dhcp excluded-address ${L[d.t3.router].net}.1 ${L[d.t3.router].net}.254 (y renovar ${L[d.t3.router].short}-2)`;
      case "t4": return d.t4.variant === "rip" ? `En ${d.t4.z}: router rip → no network ${L[d.t4.z].net}.0` : `Enrutamiento estático en los 3 routers; en ${d.t4.z}: no ip route ${L[d.t4.a].net}.0 255.255.255.0 ${L[d.t4.a].transit}`;
      case "t5": return d.t5.variant === "pool" ? `En ${d.t5.router}: ip dhcp pool ${L[d.t5.router].pool} → dns-server ${d.t5.wrongDns} (y renovar los PC)` : `En ${L[d.t5.router].short}-1: IP Configuration → DNS Server ${d.t5.wrongDns} (estática)`;
    }
  }
  function sol() {
    const v = $("#view");
    v.innerHTML = `<h2>Solucionario por equipo</h2><p class="muted small">Escribe el código de 4 caracteres que aparece arriba en la pantalla del equipo.</p>
      <form id="f" class="answer"><label><span>Código</span><input id="gc" class="mono" maxlength="4" placeholder="XXXX"></label><button class="btn" type="submit">Ver soluciones</button></form><div id="out" style="margin-top:18px"></div>`;
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const code = $("#gc").value.trim().toUpperCase(); if (code.length !== 4) return;
      const d = CN.deriveGroup(code), tk = CN.tickets(d);
      $("#out").innerHTML = `<div class="sol">${tk.map((t, i) => `<div><b>TICKET ${i + 1} · ${esc(t.title)}</b>
        <p><i>Síntoma:</i> “${esc(t.quote)}”</p>
        <p><i>Fallo introducido:</i> <code>${esc(faultText(t, d))}</code></p>
        <p><i>Parte correcto:</i> ${CN.CATS[t.answer.cat]} · dispositivo <b>${t.answer.device}</b> · ${esc(t.causes.find((c) => c.id === t.answer.cause).t)} · evidencia: ${t.answer.cmds.join(" / ")}</p>
        <p><i>Solución:</i> <code>${esc(t.solution)}</code></p></div>`).join("")}</div>`;
    };
  }
  gate();
})();
