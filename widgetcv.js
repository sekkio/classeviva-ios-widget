/*
 * ClasseViva Widget for Scriptable
 *
 * Installazione:
 * 1. Importa questo file in Scriptable.
 * 2. Eseguilo dall'app per inserire le credenziali e scegliere lo sfondo.
 * 3. Aggiungi un widget Medium alla schermata Home.
 *
 * Dipendenze: Scriptable per iOS. Non sono necessarie librerie esterne.
 * Compatibilita: le API ClasseViva e i relativi header non sono ufficiali
 * e possono cambiare senza preavviso. Non pubblicare credenziali o cache.
 */

// ==========================================================
// === CONFIGURAZIONE =======================================
// ==========================================================
const FORCE_TEST_LOGIN = true;
const KEYCHAIN_USER = "cv_user_v2";
const KEYCHAIN_PASS = "cv_pass_v2";
const CACHE_FILE = "cv_grades_cache.json";
const BACKGROUND_FILE = "cv_widget_bg.png";

const LOGIN_URL = "https://web.spaggiari.eu/rest/v1/auth/login";
const API_BASE = "https://web.spaggiari.eu/rest/v1";
const API_USER_AGENT = "CVVS/std/4.2.3";
const API_KEY = "Tg1NWEwNGIgIC0K";
const API_APP_CODE = "SD";
let credentialsReady = false;

// ==========================================================
// === UTILITY ===============================================
// ==========================================================
function emptyData(message) {
  return { media: "N/D", ultimiVoti: [], messaggioErr: message || "" };
}

function credentialsArePresent() {
  if (!Keychain.contains(KEYCHAIN_USER) ||
      !Keychain.contains(KEYCHAIN_PASS)) {
    return false;
  }

  return Keychain.get(KEYCHAIN_USER).trim() !== "" &&
    Keychain.get(KEYCHAIN_PASS) !== "";
}

function responseStatus(request) {
  return request.response ? request.response.statusCode : null;
}

// ==========================================================
// === AUTENTICAZIONE ========================================
// ==========================================================
async function getCredentials() {
  if (credentialsReady && credentialsArePresent()) {
    return {
      username: Keychain.get(KEYCHAIN_USER),
      password: Keychain.get(KEYCHAIN_PASS)
    };
  }

  let mustReset = FORCE_TEST_LOGIN && config.runsInApp;

  if (!mustReset && credentialsArePresent()) {
    return {
      username: Keychain.get(KEYCHAIN_USER),
      password: Keychain.get(KEYCHAIN_PASS)
    };
  }

  if (!config.runsInApp) {
    throw new Error("Apri Scriptable per inserire le credenziali.");
  }

  removeCredentials();

  let alert = new Alert();
  alert.title = "Login ClasseViva";
  alert.message = "Inserisci username/codice fiscale e password.";
  alert.addTextField("Username / Codice Fiscale");
  alert.addSecureTextField("Password");
  alert.addAction("Salva e continua");
  alert.addCancelAction("Annulla");

  let result = await alert.presentAlert();
  if (result === -1) {
    throw new Error("Inserimento credenziali annullato.");
  }

  let username = alert.textFieldValue(0).trim().toUpperCase();
  let password = alert.textFieldValue(1);
  if (!username || !password) {
    throw new Error("Username e password sono obbligatori.");
  }

  Keychain.set(KEYCHAIN_USER, username);
  Keychain.set(KEYCHAIN_PASS, password);
  credentialsReady = true;
  return { username, password };
}

function removeCredentials() {
  if (Keychain.contains(KEYCHAIN_USER)) {
    Keychain.remove(KEYCHAIN_USER);
  }
  if (Keychain.contains(KEYCHAIN_PASS)) {
    Keychain.remove(KEYCHAIN_PASS);
  }
}

async function showLoginError(message) {
  removeCredentials();
  if (!config.runsInApp) return;

  let alert = new Alert();
  alert.title = "Login ClasseViva fallito";
  alert.message = message + "\n\nLe credenziali sono state rimosse.";
  alert.addAction("OK");
  await alert.presentAlert();
}

// ==========================================================
// === CACHE =================================================
// ==========================================================
function readCache(fm, path, message) {
  if (!fm.fileExists(path)) return emptyData(message);

  try {
    let cached = JSON.parse(fm.readString(path));
    let data = cached.data || cached;
    data.messaggioErr = message || "";
    return data;
  } catch (error) {
    console.log("Cache non leggibile: " + error.message);
    return emptyData(message);
  }
}

function writeCache(fm, path, data) {
  try {
    fm.writeString(path, JSON.stringify({
      updatedAt: new Date().toISOString(),
      data: data
    }));
  } catch (error) {
    console.log("Errore salvataggio cache: " + error.message);
  }
}

// ==========================================================
// === API CLASSEVIVA ========================================
// ==========================================================
async function getDati() {
  let fm = FileManager.local();
  let cachePath = fm.joinPath(fm.documentsDirectory(), CACHE_FILE);
  let loginReq = null;

  try {
    let credentials = await getCredentials();
    let username = credentials.username.trim().toUpperCase();
    let password = credentials.password;

    loginReq = new Request(LOGIN_URL);
    loginReq.method = "POST";
    loginReq.headers = {
      "Content-Type": "application/json",
      "User-Agent": API_USER_AGENT,
      "Z-Dev-ApiKey": API_KEY,
      "cv-app-code": API_APP_CODE
    };
    loginReq.body = JSON.stringify({
      ident: null,
      uid: username,
      pass: password
    });

    let loginBody = await loginReq.loadString();
    let loginStatus = responseStatus(loginReq);
    if (loginStatus !== 200) {
      console.log("Login Status: " + loginStatus + " Body: " + loginBody);
      if (loginStatus === 401 || loginStatus === 403) {
        await showLoginError("Username o password non validi.");
      }
      return readCache(fm, cachePath, "Login non riuscito.");
    }

    let login;
    try {
      login = JSON.parse(loginBody);
    } catch (error) {
      throw new Error("Risposta login non valida.");
    }

    if (!login || !login.token) {
      console.log("Login senza token: " + loginBody);
      await showLoginError("Token di autenticazione assente.");
      return readCache(fm, cachePath, "Autenticazione non riuscita.");
    }

    let studentId = login.ident
      ? String(login.ident).replace(/\D/g, "")
      : "";
    if (!studentId) throw new Error("ID studente assente nel login.");

    let gradesReq = new Request(
      API_BASE + "/students/" + studentId + "/grades"
    );
    gradesReq.method = "GET";
    gradesReq.headers = {
      "Content-Type": "application/json",
      "Z-Auth-Token": login.token,
      "User-Agent": API_USER_AGENT,
      "Z-Dev-ApiKey": API_KEY,
      "cv-app-code": API_APP_CODE
    };

    let gradesBody = await gradesReq.loadString();
    let gradesStatus = responseStatus(gradesReq);
    if (gradesStatus !== 200) {
      console.log("Grades Status: " + gradesStatus + " Body: " + gradesBody);
      throw new Error("Recupero voti fallito (HTTP " + gradesStatus + ").");
    }

    let grades;
    try {
      grades = JSON.parse(gradesBody);
    } catch (error) {
      throw new Error("Risposta voti non valida.");
    }

    let data = calcolaMedia(
      grades && Array.isArray(grades.grades) ? grades.grades : []
    );
    writeCache(fm, cachePath, data);
    return data;
  } catch (error) {
    if (!credentialsArePresent()) {
      return emptyData(
        config.runsInApp
          ? "Inserisci username e password per iniziare."
          : "Apri Scriptable e inserisci username e password."
      );
    }

    if (loginReq && loginReq.response) {
      let status = loginReq.response.statusCode;
      if (status === 401 || status === 403) {
        await showLoginError("Username o password non validi.");
      }
    }
    console.log("Errore ClasseViva: " + error.message);
    return readCache(fm, cachePath, error.message);
  }
}

// ==========================================================
// === ELABORAZIONE VOTI ====================================
// ==========================================================
function calcolaMedia(voti) {
  if (!voti || voti.length === 0) {
    return { media: "N/D", ultimiVoti: [] };
  }

  let validi = voti.filter(v => {
    if (!v || v.displayPositivity === "N") return false;
    let value = Number(v.decimalValue);
    return v.decimalValue !== null &&
      v.decimalValue !== undefined &&
      v.decimalValue !== "" &&
      Number.isFinite(value);
  });

  let sum = validi.reduce(
    (total, grade) => total + Number(grade.decimalValue),
    0
  );
  let media = validi.length
    ? (sum / validi.length).toFixed(2)
    : "N/D";

  let ultimiVoti = voti.slice(-3).reverse().map(v => ({
    materia: v.subjectCode || v.subjectDesc || "Materia",
    voto: v.displayValue || String(v.decimalValue || "N/D")
  }));

  return { media, ultimiVoti };
}

// ==========================================================
// === SFONDO ================================================
// ==========================================================
async function loadBackground() {
  let localFm = FileManager.local();
  let iCloudFm = FileManager.iCloud();
  let localPath = localFm.joinPath(
    localFm.documentsDirectory(),
    BACKGROUND_FILE
  );
  let iCloudPath = iCloudFm.joinPath(
    iCloudFm.documentsDirectory(),
    BACKGROUND_FILE
  );
  let image = null;

  let mustSelectNewImage = FORCE_TEST_LOGIN && config.runsInApp;

  if (!mustSelectNewImage && localFm.fileExists(localPath)) {
    try {
      image = localFm.readImage(localPath);
    } catch (error) {
      console.log("Errore lettura sfondo locale: " + error.message);
    }
  }

  if (!mustSelectNewImage && !image && iCloudFm.fileExists(iCloudPath)) {
    try {
      if (!iCloudFm.isFileDownloaded(iCloudPath)) {
        await iCloudFm.downloadFileFromiCloud(iCloudPath);
      }
      image = iCloudFm.readImage(iCloudPath);
      if (image && !localFm.fileExists(localPath)) {
        localFm.writeImage(localPath, image);
      }
    } catch (error) {
      console.log("Errore lettura sfondo iCloud: " + error.message);
    }
  }

  if (config.runsInApp && (FORCE_TEST_LOGIN || !image)) {
    try {
      image = await Photos.fromLibrary();
      if (image) {
        localFm.writeImage(localPath, image);
        iCloudFm.writeImage(iCloudPath, image);
      }
    } catch (error) {
      console.log("Selezione sfondo annullata: " + error.message);
    }
  }

  return image;
}

// ==========================================================
// === WIDGET UI =============================================
// ==========================================================
async function buildWidget() {
  if (config.runsInApp) {
    await getCredentials();
  }

  let data = await getDati();
  let widget = new ListWidget();
  widget.url = "scriptable:///run";
  widget.setPadding(14, 16, 14, 16);

  if (!credentialsArePresent() && !config.runsInApp) {
    widget.backgroundColor = new Color("#1c1c1e");
    let setupText = widget.addText(
      config.runsInApp
        ? "Inserisci username e password."
        : "Apri Scriptable per configurare il widget."
    );
    setupText.font = Font.semiboldSystemFont(11);
    setupText.textColor = Color.white();
    setupText.lineLimit = 4;
    return widget;
  }

  let background = await loadBackground();
  if (background) {
    widget.backgroundImage = background;
  } else {
    widget.backgroundColor = new Color("#1c1c1e");
  }

  if (data.messaggioErr && data.media === "N/D") {
    let errorText = widget.addText(data.messaggioErr);
    errorText.font = Font.semiboldSystemFont(11);
    errorText.textColor = Color.white();
    errorText.lineLimit = 4;
    return widget;
  }

  let row = widget.addStack();
  row.layoutHorizontally();
  let content = row.addStack();
  content.layoutVertically();
  content.setPadding(0, 0, 0, 0);

  let title = content.addText("MEDIA");
  title.leftAlignText();
  title.font = Font.boldSystemFont(11);
  title.textColor = new Color("#202124");

  content.addSpacer(2);
  let media = content.addText(data.media);
  media.leftAlignText();
  media.font = Font.boldSystemFont(38);
  media.textColor = data.media !== "N/D"
    ? (Number(data.media) >= 6
      ? new Color("#087f45")
      : new Color("#b4233f"))
    : new Color("#202124");

  if (data.ultimiVoti.length > 0) {
    content.addSpacer(4);
    let latestTitle = content.addText("ULTIMI VOTI");
    latestTitle.leftAlignText();
    latestTitle.font = Font.boldSystemFont(9);
    latestTitle.textColor = new Color("#202124");
    content.addSpacer(2);

    let latest = content.addText(
      data.ultimiVoti.map(v => v.materia + ": " + v.voto).join("\n")
    );
    latest.leftAlignText();
    latest.font = Font.systemFont(9);
    latest.textColor = new Color("#202124");
    latest.lineLimit = 3;
  }

  row.addSpacer();
  return widget;
}

// ==========================================================
// === AVVIO =================================================
// ==========================================================
let widget = await buildWidget();

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  widget.presentMedium();
}

Script.complete();
