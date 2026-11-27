const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const APP_URL = "http://127.0.0.1:3210";
const CONFIG_FILE = () => path.join(app.getPath("userData"), "credentials.enc");
let backend = null;
let mainWindow = null;
let setupWindow = null;
let quitting = false;

app.setAppUserModelId("com.syb.maya");
if (!app.requestSingleInstanceLock()) app.quit();

function readConfig() {
  const file = CONFIG_FILE();
  if (!fs.existsSync(file)) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable.");
  const encrypted = fs.readFileSync(file);
  const value = JSON.parse(safeStorage.decryptString(encrypted));
  if (!value || typeof value.email !== "string" || typeof value.password !== "string") {
    throw new Error("The encrypted Maya configuration is invalid.");
  }
  return value;
}

function writeConfig(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable; Maya will not save credentials in plaintext.");
  const encrypted = safeStorage.encryptString(JSON.stringify(value));
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), encrypted, { mode: 0o600 });
}

ipcMain.handle("maya:save-config", async (_event, input) => {
  const email = String(input && input.email || "").trim();
  const password = String(input && input.password || "");
  const apiKey = String(input && input.apiKey || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid Founder email address.");
  if (password.length < 16) throw new Error("Founder password must contain at least 16 characters.");
  if (apiKey && apiKey.length < 20) throw new Error("The Gemini API key looks too short.");
  writeConfig({ email, password, apiKey });
  return { saved: true };
});

function showSetup(existing) {
  if (mainWindow) { mainWindow.close(); mainWindow = null; }
  if (setupWindow && !setupWindow.isDestroyed()) { setupWindow.focus(); return; }
  setupWindow = new BrowserWindow({
    width: 560, height: 680, minWidth: 480, minHeight: 620,
    title: "Maya — First-time setup",
    backgroundColor: "#07111f",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  setupWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  setupWindow.loadFile(path.join(__dirname, "setup.html"), { query: { email: existing && existing.email || "" } });
  setupWindow.on("closed", () => { setupWindow = null; });
}

async function waitForBackend(child) {
  const deadline = Date.now() + 45000;
  let lastError = "Backend did not become ready.";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Maya backend exited before becoming ready. Check the application logs.");
    try {
      const response = await fetch(APP_URL + "/api/health");
      if (response.ok) return;
      lastError = "Health endpoint returned HTTP " + response.status;
    } catch (error) { lastError = error.message; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Maya backend startup timed out: " + lastError);
}

async function startBackend(config) {
  if (backend && backend.exitCode === null) return;
  const appRoot = app.getAppPath();
  const serverFile = path.join(appRoot, "dist", "server.cjs");
  if (!fs.existsSync(serverFile)) throw new Error("Packaged Maya backend is missing: " + serverFile);
  const env = {
    ...process.env,
    NODE_ENV: "production",
    ELECTRON_RUN_AS_NODE: "1",
    PORT: "3210",
    MAYA_HOST: "127.0.0.1",
    MAYA_DATA_DIR: path.join(app.getPath("userData"), "data"),
    MAYA_FOUNDER_EMAIL: config.email,
    MAYA_FOUNDER_PASSWORD: config.password,
    GEMINI_API_KEY: config.apiKey || "",
    MAYA_TASK_WORKER_ENABLED: "false",
    MAYA_PLAN_WORKER_ENABLED: "false",
    MAYA_SCHEDULE_WORKER_ENABLED: "false"
  };
  backend = spawn(process.execPath, [serverFile], {
    cwd: appRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  backend.stdout.on("data", chunk => console.log("[Maya backend] " + String(chunk).trimEnd()));
  backend.stderr.on("data", chunk => console.error("[Maya backend] " + String(chunk).trimEnd()));
  backend.on("exit", (code, signal) => {
    console.log("[Maya backend] exited", code, signal);
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox("Maya backend stopped", "The local Maya service stopped. Restart Maya to try again.");
    }
  });
  await waitForBackend(backend);
}

async function openMaya(config) {
  try {
    await startBackend(config);
    if (setupWindow) { setupWindow.close(); setupWindow = null; }
    mainWindow = new BrowserWindow({
      width: 1440, height: 940, minWidth: 1024, minHeight: 700,
      title: "Maya",
      backgroundColor: "#020617",
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith(APP_URL + "/")) event.preventDefault();
    });
    mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
    mainWindow.on("closed", () => { mainWindow = null; });
    await mainWindow.loadURL(APP_URL);
  } catch (error) {
    dialog.showErrorBox("Unable to start Maya", error.message || String(error));
    app.quit();
  }
}

function stopBackend() {
  if (backend && backend.exitCode === null) {
    backend.kill();
    backend = null;
  }
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Maya", submenu: [
      { label: "Configure Founder account and Gemini key…", click: async () => {
        stopBackend();
        let existing = null;
        try { existing = readConfig(); } catch (error) { dialog.showErrorBox("Maya configuration", error.message); }
        showSetup(existing);
      }},
      { type: "separator" },
      { role: "quit" }
    ]},
    { label: "View", submenu: [
      { role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }
    ]}
  ]));
}

app.on("second-instance", () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  else if (setupWindow) setupWindow.focus();
});

app.whenReady().then(async () => {
  installMenu();
  let config = null;
  try { config = readConfig(); }
  catch (error) {
    dialog.showErrorBox("Maya secure storage", error.message);
  }
  if (!config) showSetup(null);
  else await openMaya(config);
});

app.on("before-quit", () => { quitting = true; stopBackend(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    let config = null;
    try { config = readConfig(); } catch {}
    if (config) void openMaya(config); else showSetup(null);
  }
});
