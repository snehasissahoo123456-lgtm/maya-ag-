const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const installDir = process.argv[2];
  if (!installDir) throw new Error("Pass the installed Maya directory.");
  const executable = path.join(installDir, "Maya.exe");
  const appRoot = path.join(installDir, "resources", "app");
  const serverFile = path.join(appRoot, "dist", "server.cjs");
  if (!fs.existsSync(executable)) throw new Error("Installed Maya.exe is missing.");
  if (!fs.existsSync(serverFile)) throw new Error("Packaged backend bundle is missing.");
  const port = String(3217 + Math.floor(Math.random() * 200));
  const child = spawn(executable, [serverFile], {
    cwd: appRoot,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: port,
      MAYA_HOST: "127.0.0.1",
      MAYA_DATA_DIR: path.join(process.env.RUNNER_TEMP || require("node:os").tmpdir(), "maya-electron-smoke-data"),
      MAYA_FOUNDER_EMAIL: process.env.MAYA_TEST_EMAIL || "ci-founder@example.invalid",
      MAYA_FOUNDER_PASSWORD: process.env.MAYA_TEST_PASSWORD || "CI-only-test-password-12345",
      GEMINI_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", chunk => { logs += String(chunk); });
  child.stderr.on("data", chunk => { logs += String(chunk); });
  const url = "http://127.0.0.1:" + port + "/api/health";
  const deadline = Date.now() + 45000;
  let healthy = false;
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(url);
        if (response.ok) { healthy = true; break; }
        logs += "\nhealth status: " + response.status;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!healthy) throw new Error("Packaged backend did not pass /api/health. Logs:\n" + logs.slice(-12000));
    console.log("PASS: installed Maya.exe launched its packaged Node backend and /api/health returned HTTP 200.");
  } finally {
    child.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
