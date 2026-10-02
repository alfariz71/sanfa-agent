// ============================================================
//  Sanfa Agent — electron/main.js
//  Native Desktop Client (Antigravity-Style)
//  Loads the unified Sanfa Web UI & runs background bridge
// ============================================================

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const bridgeClient = require('./bridge-client');

function resolveAssetsDir() {
  const candidates = [
    path.join(process.resourcesPath, 'assets'),
    path.join(__dirname, 'assets'),
    path.join(__dirname, '..', 'electron', 'assets'),
    path.join(process.cwd(), 'electron', 'assets')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return path.join(__dirname, 'assets');
}

const ASSETS_DIR = resolveAssetsDir();

const LOCAL_SERVER = 'http://127.0.0.1:3333';
const REMOTE_SERVER = 'https://sanfaagent.my.id';

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Cek apakah server lokal aktif
function checkUrl(urlStr, timeoutMs = 1500) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const client = u.protocol === 'https:' ? https : http;
      const req = client.get(urlStr, { timeout: timeoutMs }, (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 400);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    } catch {
      resolve(false);
    }
  });
}

async function determineTargetUrl() {
  // 1. Cek server lokal dulu (misal running via run-all.bat di Asus)
  const isLocalAlive = await checkUrl(`${LOCAL_SERVER}/api/health`, 1500);
  if (isLocalAlive) {
    console.log('[Sanfa] Connecting to local server:', LOCAL_SERVER);
    return LOCAL_SERVER;
  }

  // 2. Kalau lokal tidak ada, gunakan remote cloudflare tunnel
  console.log('[Sanfa] Connecting to remote server:', REMOTE_SERVER);
  return REMOTE_SERVER;
}

function createWindow(targetUrl) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 840,
    minHeight: 560,
    title: 'Sanfa Agent',
    icon: path.join(ASSETS_DIR, 'icon.ico'),
    backgroundColor: '#110a06',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(targetUrl);

  // Minimize ke tray saat ditutup
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const icoPath = path.join(ASSETS_DIR, 'icon.ico');
  const pngPath = path.join(ASSETS_DIR, 'tray-icon.png');
  let icon = null;

  if (fs.existsSync(icoPath)) {
    icon = nativeImage.createFromPath(icoPath);
  } else if (fs.existsSync(pngPath)) {
    icon = nativeImage.createFromPath(pngPath).resize({ width: 16, height: 16 });
  } else {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Sanfa Agent');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Buka Sanfa Agent',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Buka di Browser',
      click: () => shell.openExternal(REMOTE_SERVER),
    },
    { type: 'separator' },
    {
      label: 'Keluar',
      click: () => {
        isQuitting = true;
        bridgeClient.stopBridge();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// IPC: Terima token dari web untuk auto-start bridge di laptop lokal
ipcMain.on('sync-bridge', (event, data) => {
  if (data && data.token) {
    const sUrl = data.serverUrl || REMOTE_SERVER;
    console.log('[Sanfa Electron] Auto-starting bridge for session...');
    bridgeClient.startBridge(sUrl, data.token);
  }
});

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Enable auto-start with Windows on boot
    try {
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: true
      });
    } catch (e) {
      console.warn('[Electron] Gagal set login item:', e.message);
    }

    createTray();
    const targetUrl = await determineTargetUrl();
    createWindow(targetUrl);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(targetUrl);
      }
    });
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  bridgeClient.stopBridge();
});
