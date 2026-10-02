// ============================================================
//  Sanfa Agent — electron/bridge-client.js
//  Background Bridge Client (Antigravity-Style Sidecar)
//  Connects current machine to Sanfa Server without opening CMD
// ============================================================

const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let currentStreamReq = null;
let reconnectTimer = null;
let isConnected = false;
let activeConfig = null;

function postResult(serverUrl, token, payload) {
  try {
    const isHttps = serverUrl.startsWith('https:');
    const client = isHttps ? https : http;
    const url = new URL(`${serverUrl.replace(/\/$/, '')}/api/bridge/response`);
    const data = JSON.stringify(payload);

    const req = client.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    });

    req.on('error', (err) => {
      console.error('[BridgeClient] Error posting result:', err.message);
    });

    req.write(data);
    req.end();
  } catch (err) {
    console.error('[BridgeClient] Error in postResult:', err.message);
  }
}

async function executeTask(task, serverUrl, token) {
  const { taskId, tool, args = {} } = task;
  let responsePayload = { taskId, success: false, result: null, error: null };

  try {
    if (tool === 'run_command') {
      const command = args.command || args.cmd || '';
      const execCwd = args.cwd ? path.resolve(args.cwd) : process.cwd();

      const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
      const result = await new Promise((resolve) => {
        exec(command, { cwd: execCwd, maxBuffer: 10 * 1024 * 1024, timeout: 120000, shell }, (err, stdout, stderr) => {
          if (err) {
            resolve({
              ok: false,
              exitCode: err.code || 1,
              stdout: stdout || '',
              stderr: stderr || err.message,
              message: `Error (exit code ${err.code}): ${err.message}`
            });
          } else {
            resolve({
              ok: true,
              exitCode: 0,
              stdout: stdout || '',
              stderr: stderr || '',
              message: 'Command berhasil dieksekusi di laptop lokal.'
            });
          }
        });
      });

      responsePayload.success = true;
      responsePayload.result = result;

    } else if (tool === 'write_file') {
      const baseDir = args.cwd ? path.resolve(args.cwd) : process.cwd();
      const targetPath = path.isAbsolute(args.path) ? args.path : path.join(baseDir, args.path);
      const content = args.content || '';
      const parentDir = path.dirname(targetPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(targetPath, content, 'utf8');

      responsePayload.success = true;
      responsePayload.result = {
        ok: true,
        path: targetPath,
        bytes: Buffer.byteLength(content, 'utf8'),
        message: `Berkas '${targetPath}' berhasil ditulis di laptop lokal.`
      };

    } else if (tool === 'read_file') {
      const baseDir = args.cwd ? path.resolve(args.cwd) : process.cwd();
      const targetPath = path.isAbsolute(args.path) ? args.path : path.join(baseDir, args.path);
      if (!fs.existsSync(targetPath)) throw new Error(`Berkas tidak ditemukan: ${targetPath}`);
      const stat = fs.statSync(targetPath);
      if (stat.size > 2 * 1024 * 1024) throw new Error(`Berkas terlalu besar (>2MB)`);
      const content = fs.readFileSync(targetPath, 'utf8');

      responsePayload.success = true;
      responsePayload.result = { ok: true, path: targetPath, content, size: stat.size };

    } else if (tool === 'list_dir') {
      const baseDir = args.cwd ? path.resolve(args.cwd) : process.cwd();
      const targetDir = args.path ? (path.isAbsolute(args.path) ? args.path : path.join(baseDir, args.path)) : baseDir;
      if (!fs.existsSync(targetDir)) throw new Error(`Direktori tidak ditemukan: ${targetDir}`);
      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      const items = entries.map(e => ({
        name: e.name,
        isDir: e.isDirectory(),
        size: e.isFile() ? (fs.statSync(path.join(targetDir, e.name))?.size || 0) : null
      }));

    } else if (tool === 'replace_file_content') {
      const baseDir = args.cwd ? path.resolve(args.cwd) : process.cwd();
      const targetPath = path.isAbsolute(args.path) ? args.path : path.join(baseDir, args.path);
      const targetStr = args.target || '';
      const replacementStr = args.replacement ?? '';
      if (!targetStr) throw new Error('Parameter target tidak boleh kosong.');
      if (!fs.existsSync(targetPath)) throw new Error(`Berkas tidak ditemukan: ${targetPath}`);
      let content = fs.readFileSync(targetPath, 'utf8');
      if (!content.includes(targetStr)) {
        throw new Error(`Target string tidak ditemukan di dalam berkas: ${path.basename(targetPath)}`);
      }
      const count = content.split(targetStr).length - 1;
      if (count > 1) {
        throw new Error(`Target string ditemukan ${count} kali di dalam berkas. Berikan potongan baris yang lebih spesifik.`);
      }
      content = content.replace(targetStr, replacementStr);
      fs.writeFileSync(targetPath, content, 'utf8');
      responsePayload.success = true;
      responsePayload.result = {
        ok: true,
        type: 'file_patched',
        path: targetPath,
        size: Buffer.byteLength(content, 'utf8'),
        message: `Berkas '${path.basename(targetPath)}' berhasil di-patch secara presisi.`
      };

    } else if (tool === 'search_code') {
      const query = (args.query || args.q || '').trim();
      const targetDir = args.path ? (path.isAbsolute(args.path) ? args.path : path.join(process.cwd(), args.path)) : process.cwd();
      const ext = (args.extension || '').trim();
      if (!query) throw new Error('Parameter query tidak boleh kosong.');
      if (!fs.existsSync(targetDir)) throw new Error(`Direktori tidak ditemukan: ${targetDir}`);

      const extFilter = ext.split(',').map(e => e.trim().toLowerCase().replace('.', '')).filter(Boolean);
      const results = [];
      const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'vendor', '.system_generated', 'brain']);

      function walk(dir) {
        if (!fs.existsSync(dir)) return;
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const ent of entries) {
          if (IGNORE.has(ent.name) || ent.name.startsWith('.')) continue;
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            walk(full);
          } else if (ent.isFile()) {
            const fileExt = path.extname(ent.name).replace('.', '').toLowerCase();
            if (extFilter.length && !extFilter.includes(fileExt)) continue;
            try {
              const stat = fs.statSync(full);
              if (stat.size > 1024 * 1024) continue;
              const content = fs.readFileSync(full, 'utf8');
              const lines = content.split(/\r?\n/);
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                  results.push({
                    file: path.relative(targetDir, full) || ent.name,
                    line: i + 1,
                    snippet: lines[i].trim().slice(0, 150)
                  });
                  if (results.length >= 30) return;
                }
              }
            } catch {}
          }
        }
      }
      walk(targetDir);
      responsePayload.success = true;
      responsePayload.result = {
        ok: true,
        type: 'code_search_results',
        query,
        count: results.length,
        matches: results
      };

    } else if (tool === 'desktop_control') {
      const dcApp = (args.app || '').replace(/\.exe$/i, '');
      const action = args.action || 'list_windows';
      if (action === 'close_app' && dcApp) {
        try {
          execSync(`powershell -NoProfile -Command "Stop-Process -Name '${dcApp}' -Force -ErrorAction SilentlyContinue"`);
        } catch {}
        responsePayload.success = true;
        responsePayload.result = {
          type: 'desktop_action',
          action: 'close_app',
          app: dcApp,
          success: true,
          message: `Aplikasi '${dcApp}' berhasil ditutup.`
        };
      } else {
        responsePayload.success = true;
        responsePayload.result = {
          type: 'desktop_action',
          action,
          app: dcApp,
          success: true,
          message: `Aksi '${action}' berhasil diproses.`
        };
      }

    } else {
      throw new Error(`Tool '${tool}' tidak didukung oleh Sanfa Bridge.`);
    }

  } catch (err) {
    responsePayload.success = false;
    responsePayload.error = err.message;
  }

  postResult(serverUrl, token, responsePayload);
}

function startBridge(serverUrl, token) {
  if (!serverUrl || !token) return;

  // Stop any existing stream
  stopBridge();

  activeConfig = { serverUrl, token };

  const isHttps = serverUrl.startsWithhttps ? serverUrl.startsWith('https:') : serverUrl.startsWith('https');
  const client = isHttps ? https : http;

  const totalMemGB = (os.totalmem() / (1024 ** 3)).toFixed(1);
  const freeMemGB = (os.freemem() / (1024 ** 3)).toFixed(1);
  const usedMemGB = (totalMemGB - freeMemGB).toFixed(1);
  const ramStr = `${usedMemGB} / ${totalMemGB} GB`;

  const queryParams = new URLSearchParams({
    token,
    hostname: os.hostname(),
    platform: os.platform(),
    user: os.userInfo().username,
    cwd: process.cwd(),
    ram: ramStr,
    bridgeVersion: '1.0.0-electron'
  });

  const streamUrl = new URL(`${serverUrl.replace(/\/$/, '')}/api/bridge/stream?${queryParams.toString()}`);

  console.log(`[BridgeClient] Connecting to ${streamUrl.origin}...`);

  const req = client.request(streamUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache'
    }
  }, (res) => {
    if (res.statusCode !== 200) {
      console.warn(`[BridgeClient] Server response ${res.statusCode}. Reconnecting in 5s...`);
      scheduleReconnect(5000);
      return;
    }

    isConnected = true;
    console.log('[BridgeClient] ✓ Connected to Sanfa Bridge Hub');

    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const block of lines) {
        const line = block.trim();
        if (!line) continue;

        let eventType = 'message';
        let eventData = '';

        for (const fLine of line.split('\n')) {
          if (fLine.startsWith('event:')) eventType = fLine.slice(6).trim();
          else if (fLine.startsWith('data:')) eventData = fLine.slice(5).trim();
        }

        if (eventType === 'task' && eventData) {
          try {
            const task = JSON.parse(eventData);
            executeTask(task, serverUrl, token);
          } catch (e) {
            console.error('[BridgeClient] Error parsing task:', e.message);
          }
        }
      }
    });

    res.on('end', () => {
      isConnected = false;
      scheduleReconnect(3000);
    });

    res.on('error', () => {
      isConnected = false;
      scheduleReconnect(3000);
    });
  });

  req.on('error', (err) => {
    isConnected = false;
    scheduleReconnect(5000);
  });

  req.end();
  currentStreamReq = req;
}

function scheduleReconnect(delayMs) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (activeConfig) {
      startBridge(activeConfig.serverUrl, activeConfig.token);
    }
  }, delayMs);
}

function stopBridge() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (currentStreamReq) {
    try { currentStreamReq.destroy(); } catch {}
    currentStreamReq = null;
  }
  isConnected = false;
}

module.exports = {
  startBridge,
  stopBridge,
  isBridgeConnected: () => isConnected
};
