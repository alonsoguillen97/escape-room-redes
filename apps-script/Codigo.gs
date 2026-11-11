/**
 * CÓDIGO ROJO EN LA RED · Ranking automático
 * ------------------------------------------------------------
 * Pega este código en Extensiones → Apps Script de una Hoja de cálculo de Google
 * e impleméntalo como Aplicación web (ver README).
 *
 * - Los alumnos ENVÍAN su progreso (POST) al empezar, al cerrar cada ticket y al terminar.
 * - El panel del profesor LEE el ranking (GET) solo si envía el PIN correcto.
 *
 * Cambia el PIN aquí abajo: es lo único que protege la lectura de los resultados
 * (este archivo no se publica en la web de los alumnos).
 */
const PIN = "CAMBIA-ESTE-PIN";
const SECRET = "CODIGO-ROJO|1ASIR|PAR|UD2|v1"; // igual que CONFIG.SECRET en js/core.js
const SHEET = "Resultados";
// Si el script NO se creó desde la hoja (Extensiones → Apps Script), pon aquí el ID de la hoja
// (la parte de la URL entre /d/ y /edit). Si se creó desde la hoja, déjalo vacío.
const SHEET_ID = "";
const HEAD = ["Código", "Alumno/a", "Puntos", "Tickets", "Pistas", "Partes erróneos", "Terminado", "Inicio", "Última actualización", "Firma válida"];

function sheet_() {
  const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(HEAD);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEAD.length).setFontWeight("bold").setBackground("#101C3A").setFontColor("#A9DB2E");
  }
  return sh;
}

function hex_(bytes) {
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, "0"); }).join("");
}

function verify_(d) {
  const payload = [d.code, d.name, d.score, d.tickets, d.hints, d.errors, d.finished ? 1 : 0, d.start].join("|");
  const dig = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, SECRET + "#RANK#" + payload, Utilities.Charset.UTF_8);
  return hex_(dig).slice(0, 16) === String(d.chk);
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (!/^[A-Z0-9]{4}$/.test(String(d.code))) return out_({ ok: false });
    const sh = sheet_();
    const vals = sh.getDataRange().getValues();
    let row = -1;
    for (let i = 1; i < vals.length; i++) if (vals[i][0] === d.code) { row = i + 1; break; }
    const rec = [d.code, String(d.name || "").slice(0, 60), Number(d.score) || 0, Number(d.tickets) || 0, Number(d.hints) || 0, Number(d.errors) || 0,
      d.finished ? "Sí" : "No", new Date(Number(d.start) || Date.now()), new Date(), verify_(d) ? "Sí" : "NO"];
    if (row > 0) sh.getRange(row, 1, 1, rec.length).setValues([rec]);
    else sh.appendRow(rec);
    return out_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  if (!e || !e.parameter || e.parameter.pin !== PIN) return out_({ error: "pin" });
  const rows = sheet_().getDataRange().getValues().slice(1).map(function (r) {
    return { code: r[0], name: r[1], score: r[2], tickets: r[3], hints: r[4], errors: r[5], finished: r[6] === "Sí",
      start: r[7] instanceof Date ? r[7].getTime() : r[7], updated: r[8] instanceof Date ? r[8].getTime() : r[8], verified: r[9] === "Sí" };
  });
  return out_({ rows: rows });
}
