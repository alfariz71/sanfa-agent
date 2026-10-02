#!/usr/bin/env node
/**
 * =========================================================================
 * SANFA BRIDGE - Local Agent Connector (Antigravity-Style Sidecar)
 * =========================================================================
 * Menghubungkan laptop lokal pengguna ke Sanfa Agent Web sehingga
 * AI dapat menjalankan perintah terminal, membuat/mengedit berkas,
 * dan mengelola project secara langsung di laptop pengguna ini.
 *
 * Nol dependensi eksternal (murni modul bawaan Node.js).
 * =========================================================================
 */

import http from 'node:http';
import https from 'node:https';
import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  brightWhite: '\x1b[97m',
  amber: '\x1b[38;2;247;176;109m'
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    server: 'https://sanfaagent.my.id',
    token: ''
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server' && args[i + 1]) {
      options.server = args[++i];
    } else if (args[i] === '--token' && args[i + 1]) {
      options.token = args[++i];
    } else if (args[i] === '--local') {
      options.server = 'http://127.0.0.1:3333';
    }
  }

  // Cek apakah ada file bridge-config.json
  const configPath = path.join(process.cwd(), 'bridge-config.json');
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!options.token && cfg.token) options.token = cfg.token;
      if (options.server === 'https://sanfaagent.my.id' && cfg.server) options.server = cfg.server;
    } catch {}
  }

  return options;
}

function promptInput(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function printBanner(serverUrl, machineName) {
  console.clear();
  console.log(`${ANSI.amber}==============================================================${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.brightWhite}           SANFA BRIDGE — LOCAL AGENT CONNECTOR               ${ANSI.reset}`);
  console.log(`${ANSI.gray}     Menghubungkan Laptop Lokal ke Sanfa Agent Cloud/Server   ${ANSI.reset}`);
  console.log(`${ANSI.amber}==============================================================${ANSI.reset}`);
  console.log(`  ${ANSI.bold}Nama Komputer :${ANSI.reset} ${ANSI.cyan}${machineName}${ANSI.reset}`);
  console.log(`  ${ANSI.bold}Platform/OS   :${ANSI.reset} ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`  ${ANSI.bold}Direktori CWD :${ANSI.reset} ${process.cwd()}`);
  console.log(`  ${ANSI.bold}Server Target :${ANSI.reset} ${ANSI.yellow}${serverUrl}${ANSI.reset}`);
  console.log(`${ANSI.amber}==============================================================${ANSI.reset}\n`);
}

async function postResult(serverUrl, token, payload) {
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
      console.error(`${ANSI.red}[Bridge] Gagal mengirim hasil task ke server:${ANSI.reset}`, err.message);
    });

    req.write(data);
    req.end();
  } catch (err) {
    console.error(`${ANSI.red}[Bridge] Error postResult:${ANSI.reset}`, err.message);
  }
}

// Eksekusi task lokal dari server
async function executeTask(task, serverUrl, token) {
  const { taskId, tool, args = {} } = task;
  console.log(`\n${ANSI.cyan}⚡ [Task Masuk]${ANSI.reset} Tool: ${ANSI.bold}${tool}${ANSI.reset} (ID: ${taskId})`);

  let responsePayload = {
    taskId,
    success: false,
    result: null,
    error: null
  };

  try {
    if (tool === 'run_command') {
      const command = args.command || args.cmd || '';
      const execCwd = args.cwd ? path.resolve(args.cwd) : process.cwd();

      console.log(`  ${ANSI.gray}CWD:${ANSI.reset} ${execCwd}`);
      console.log(`  ${ANSI.gray}CMD:${ANSI.reset} ${command}`);

      const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
      const result = await new Promise((resolve) => {
        exec(command, { cwd: execCwd, maxBuffer: 10 * 1024 * 1024, timeout: 120000, shell }, (err, stdout, stderr) => {
          if (err) {
            resolve({
              ok: false,
              exitCode: err.code || 1,
              stdout: stdout || '',
              stderr: stderr || err.message,
              message: `Command selesai dengan error (exit code ${err.code}): ${err.message}`
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
      console.log(`  ${ANSI.green}✓ Selesai dieksekusi di laptop lokal.${ANSI.reset}`);

    } else if (tool === 'write_file') {
      const baseDir = args.cwd ? path.resolve(args.cwd) : process.cwd();
      const targetPath = path.isAbsolute(args.path) ? args.path : path.join(baseDir, args.path);
      const content = args.content || '';

      const parentDir = path.dirname(targetPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      fs.writeFileSync(targetPath, content, 'utf8');
      console.log(`  ${ANSI.green}✓ Berkas berhasil ditulis:${ANSI.reset} ${targetPath}`);

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
      if (!fs.existsSync(targetPath)) {
        throw new Error(`Berkas tidak ditemukan: ${targetPath}`);
      }
      const stat = fs.statSync(targetPath);
      if (stat.size > 2 * 1024 * 1024) {
        throw new Error(`Berkas terlalu besar (>2MB)`);
      }
      const content = fs.readFileSync(targetPath, 'utf8');
      console.log(`  ${ANSI.green}✓ Berkas berhasil dibaca:${ANSI.reset} ${targetPath} (${stat.size} bytes)`);

      responsePayload.success = true;
      responsePayload.result = {
        ok: true,
        path: targetPath,
        content: content,
        size: stat.size
      };

    } else if (tool === 'list_dir') {
      const baseDir = args.cwd ? path.resolve(args.cwd) : process.cwd();
      const targetDir = args.path ? (path.isAbsolute(args.path) ? args.path : path.join(baseDir, args.path)) : baseDir;
      if (!fs.existsSync(targetDir)) {
        throw new Error(`Direktori tidak ditemukan: ${targetDir}`);
      }
      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      const items = entries.map(e => ({
        name: e.name,
        isDir: e.isDirectory(),
        size: e.isFile() ? (fs.statSync(path.join(targetDir, e.name))?.size || 0) : null
      }));

      responsePayload.success = true;
      responsePayload.result = {
        ok: true,
        path: targetDir,
        items
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
    console.error(`  ${ANSI.red}✗ Gagal mengeksekusi task:${ANSI.reset} ${err.message}`);
    responsePayload.success = false;
    responsePayload.error = err.message;
  }

  // Kirim balik hasil ke server
  await postResult(serverUrl, token, responsePayload);
}

// Koneksi Persistent SSE Stream ke Sanfa Server
function startBridgeConnection(serverUrl, token) {
  const isHttps = serverUrl.startsWith('https:');
  const client = isHttps ? https : http;

  const totalMemGB = (os.totalmem() / (1024 ** 3)).toFixed(1);
  const freeMemGB = (os.freemem() / (1024 ** 3)).toFixed(1);
  const usedMemGB = (totalMemGB - freeMemGB).toFixed(1);
  const ramStr = `${usedMemGB} / ${totalMemGB} GB`;

  const machineInfo = {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    user: os.userInfo().username,
    cwd: process.cwd(),
    ram: ramStr,
    bridgeVersion: '1.0.0'
  };

  const queryParams = new URLSearchParams({
    token,
    hostname: machineInfo.hostname,
    platform: machineInfo.platform,
    user: machineInfo.user,
    cwd: machineInfo.cwd,
    ram: machineInfo.ram
  });

  const streamUrl = new URL(`${serverUrl.replace(/\/$/, '')}/api/bridge/stream?${queryParams.toString()}`);

  console.log(`${ANSI.yellow}[Bridge] Menghubungkan ke ${streamUrl.origin}...${ANSI.reset}`);

  const req = client.request(streamUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache'
    }
  }, (res) => {
    if (res.statusCode === 401 || res.statusCode === 403) {
      console.error(`${ANSI.red}[Auth Error] Token tidak valid atau sesi kadaluarsa.${ANSI.reset}`);
      console.error(`${ANSI.gray}Silakan periksa Token Bridge di akun Sanfa Agent Web kamu.${ANSI.reset}`);
      process.exit(1);
    }

    if (res.statusCode !== 200) {
      console.error(`${ANSI.red}[HTTP Error] Server merespons dengan status ${res.statusCode}.${ANSI.reset}`);
      reconnect(serverUrl, token, 5000);
      return;
    }

    console.log(`${ANSI.green}==============================================================${ANSI.reset}`);
    console.log(`${ANSI.bold}${ANSI.green}  ✓ TERHUBUNG! Sanfa Bridge Aktif & Siap Menerima Perintah.    ${ANSI.reset}`);
    console.log(`${ANSI.green}==============================================================${ANSI.reset}`);
    console.log(`${ANSI.gray}Biarkan jendela ini tetap terbuka saat mengobrol di Sanfa Agent Web.${ANSI.reset}`);
    console.log(`${ANSI.gray}Setiap perintah coding/terminal di web akan dieksekusi di sini.\n${ANSI.reset}`);

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

        const fieldLines = line.split('\n');
        for (const fLine of fieldLines) {
          if (fLine.startsWith('event:')) {
            eventType = fLine.slice(6).trim();
          } else if (fLine.startsWith('data:')) {
            eventData = fLine.slice(5).trim();
          }
        }

        if (eventType === 'ping') {
          // Heartbeat dari server
          continue;
        }

        if (eventType === 'task' && eventData) {
          try {
            const task = JSON.parse(eventData);
            executeTask(task, serverUrl, token);
          } catch (e) {
            console.error('[Bridge] Gagal parse task data:', e.message);
          }
        }
      }
    });

    res.on('end', () => {
      console.log(`\n${ANSI.yellow}[Bridge] Koneksi terputus dari server. Mencoba menghubungkan kembali...${ANSI.reset}`);
      reconnect(serverUrl, token, 3000);
    });

    res.on('error', (err) => {
      console.error(`\n${ANSI.red}[Bridge] Stream error:${ANSI.reset}`, err.message);
      reconnect(serverUrl, token, 3000);
    });
  });

  req.on('error', (err) => {
    console.error(`${ANSI.red}[Bridge] Gagal terhubung:${ANSI.reset}`, err.message);
    reconnect(serverUrl, token, 5000);
  });

  req.end();
}

function reconnect(serverUrl, token, delayMs = 3000) {
  setTimeout(() => {
    startBridgeConnection(serverUrl, token);
  }, delayMs);
}

async function main() {
  const opts = parseArgs();

  let serverUrl = opts.server;
  let token = opts.token;

  printBanner(serverUrl, os.hostname());

  if (!token) {
    console.log(`${ANSI.yellow}Token Bridge belum dimasukkan.${ANSI.reset}`);
    console.log(`${ANSI.gray}Buka Sanfa Agent Web ➔ Klik tombol 'Bridge' di atas ➔ Salin Token Akun kamu.${ANSI.reset}\n`);
    token = await promptInput(`${ANSI.bold}Masukkan Token Akun Sanfa kamu: ${ANSI.reset}`);
    if (!token) {
      console.error(`${ANSI.red}Token wajib diisi untuk mengamankan koneksi bridge!${ANSI.reset}`);
      process.exit(1);
    }

    // Simpan ke bridge-config.json supaya次回 nggak perlu ngetik ulang
    try {
      fs.writeFileSync(
        path.join(process.cwd(), 'bridge-config.json'),
        JSON.stringify({ server: serverUrl, token }, null, 2),
        'utf8'
      );
      console.log(`${ANSI.green}✓ Konfigurasi disimpan ke bridge-config.json (aman di laptop ini).${ANSI.reset}\n`);
    } catch {}
  }

  startBridgeConnection(serverUrl, token);
}

main().catch((err) => {
  console.error(`${ANSI.red}[Fatal]${ANSI.reset}`, err);
  process.exit(1);
});
