#!/usr/bin/env node
// Web のデモの場面を、ヘッドレスの Chrome で順に操作し、確認とスクリーンショットを残す。
// 外部パッケージは使わない（Node 22 以上の組み込み WebSocket と Chrome DevTools Protocol）。
//
// 使い方：node browser.mjs <scenes.json> <ベース URL> <スクリーンショットの出力先>
// scenes.json：
//   {"viewport": [1280, 800],
//    "scenes": [{"id": 1, "title": "...", "steps": [
//      {"goto": "/"}, {"fill": ["#title", "牛乳を買う"]}, {"click": "button[type=submit]"},
//      {"press": "Enter"}, {"wait": "li.task"}, {"expect_text": ["ul", "牛乳を買う"]},
//      {"expect_count": ["li.task", 2]}, {"sleep": 500}, {"screenshot": "after-add"}]}]}
// 確認（expect_*）が1つでも外れたら、終了コード1で終わる。
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [scenesPath, baseUrl, outDir] = process.argv.slice(2);
if (!scenesPath || !baseUrl || !outDir) {
  console.error("usage: node browser.mjs <scenes.json> <base-url> <screenshot-dir>");
  process.exit(2);
}
const spec = JSON.parse(readFileSync(scenesPath, "utf8"));
const TIMEOUT = 5000;
const CHROMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), "demo-chrome-"));
  const [w, h] = spec.viewport || [1280, 800];
  const args = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    `--window-size=${w},${h}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"];
  let proc;
  for (const bin of [process.env.DEMO_CHROME, ...CHROMES].filter(Boolean)) {
    if (bin.startsWith("/") && !existsSync(bin)) continue;
    proc = spawn(bin, args, { stdio: "ignore" });
    const failed = await new Promise((r) => { proc.once("error", () => r(true)); setTimeout(() => r(false), 300); });
    if (!failed) break;
    proc = null;
  }
  if (!proc) throw new Error("Chrome が見つからない（DEMO_CHROME で実行ファイルを指定できる）");
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
  return { proc, profile, url: `ws://127.0.0.1:${port}${path}` };
}

function connect(url) {
  const ws = new WebSocket(url);
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) listeners.forEach((f) => f(msg));
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({ ws, send, on: (f) => listeners.push(f) });
    ws.onerror = () => reject(new Error("DevTools に接続できない"));
  });
}

async function main() {
  const chrome = await launch();
  const cdp = await connect(chrome.url);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const page = (m, p) => cdp.send(m, p, sessionId);
  await page("Page.enable");
  await page("Runtime.enable");
  const consoleErrors = [];
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === "Runtime.exceptionThrown") consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  const evaluate = async (expr) => {
    const r = await page("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expr, what) => {
    const until = Date.now() + TIMEOUT;
    while (Date.now() < until) {
      if (await evaluate(expr).catch(() => false)) return;
      await sleep(100);
    }
    throw new Error(`${TIMEOUT / 1000} 秒待っても ${what}`);
  };
  const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
  const loaded = () => waitFor("document.readyState === 'complete'", "読み込みが終わらない");

  mkdirSync(outDir, { recursive: true });
  let failures = 0;
  const report = [];
  for (const scene of spec.scenes) {
    console.log(`== 場面 ${scene.id}: ${scene.title} ==`);
    const result = { id: scene.id, checks: [], screenshots: [], error: null };
    try {
      for (const step of scene.steps) {
        const [op, arg] = Object.entries(step)[0];
        if (op === "goto") {
          await page("Page.navigate", { url: new URL(arg, baseUrl).href });
          await sleep(100);
          await loaded();
          console.log(`  開く：${arg}`);
        } else if (op === "click") {
          await waitFor(`!!${q(arg)}`, `${arg} が現れない`);
          await evaluate(`${q(arg)}.scrollIntoView({block: "center"})`);
          const box = await evaluate(`(() => { const r = ${q(arg)}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
          for (const type of ["mousePressed", "mouseReleased"]) {
            await page("Input.dispatchMouseEvent", { type, x: box[0], y: box[1], button: "left", clickCount: 1 });
          }
          await sleep(200);
          console.log(`  押す：${arg}`);
        } else if (op === "fill") {
          const [sel, text] = arg;
          await waitFor(`!!${q(sel)}`, `${sel} が現れない`);
          await evaluate(`(() => { const e = ${q(sel)}; e.focus(); if ("value" in e) { e.value = ""; e.dispatchEvent(new Event("input", {bubbles: true})); } })()`);
          await page("Input.insertText", { text });
          console.log(`  入力：${sel} ← ${JSON.stringify(text)}`);
        } else if (op === "press") {
          const key = { Enter: [13, "\r"], Tab: [9, "\t"], Escape: [27, ""] }[arg] || [0, arg];
          await page("Input.dispatchKeyEvent", { type: "keyDown", key: arg, windowsVirtualKeyCode: key[0], text: key[1] });
          await page("Input.dispatchKeyEvent", { type: "keyUp", key: arg, windowsVirtualKeyCode: key[0] });
          await sleep(200);
          console.log(`  キー：${arg}`);
        } else if (op === "wait") {
          await waitFor(`!!${q(arg)}`, `${arg} が現れない`);
          console.log(`  待つ：${arg}`);
        } else if (op === "sleep") {
          await sleep(arg);
        } else if (op === "expect_text" || op === "expect_no_text" || op === "expect_count") {
          const [sel, want] = arg;
          const expr = op === "expect_count"
            ? `document.querySelectorAll(${JSON.stringify(sel)}).length === ${Number(want)}`
            : `(${q(sel)}?.innerText ?? "").includes(${JSON.stringify(want)}) === ${op === "expect_text"}`;
          const ok = await waitFor(expr, "").then(() => true, () => false);
          const actual = op === "expect_count"
            ? await evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
            : (await evaluate(`${q(sel)}?.innerText ?? "(要素なし)"`)).replace(/\s+/g, " ").slice(0, 200);
          const label = { expect_text: "含む", expect_no_text: "含まない", expect_count: "個数" }[op];
          console.log(`  確認 ${ok ? "OK" : "NG"}：${sel} が ${JSON.stringify(want)} を${label === "個数" ? "個数とする" : label}（実際：${JSON.stringify(actual)}）`);
          result.checks.push({ selector: sel, op, want, ok, actual });
          if (!ok) failures++;
        } else if (op === "screenshot") {
          const { data } = await page("Page.captureScreenshot", { format: "png" });
          const file = join(outDir, `scene-${scene.id}-${arg}.png`);
          writeFileSync(file, Buffer.from(data, "base64"));
          result.screenshots.push(file);
          console.log(`  画面：${file}`);
        } else {
          throw new Error(`知らない操作：${op}`);
        }
      }
    } catch (e) {
      result.error = e.message;
      failures++;
      console.log(`  失敗：${e.message}`);
      const { data } = await page("Page.captureScreenshot", { format: "png" }).catch(() => ({}));
      if (data) {
        const file = join(outDir, `scene-${scene.id}-error.png`);
        writeFileSync(file, Buffer.from(data, "base64"));
        result.screenshots.push(file);
        console.log(`  画面：${file}`);
      }
    }
    report.push(result);
  }
  if (consoleErrors.length) console.log(`ブラウザのエラー：\n${consoleErrors.map((e) => `  ${e}`).join("\n")}`);
  writeFileSync(join(outDir, "report.json"), JSON.stringify({ failures, scenes: report, console_errors: consoleErrors }, null, 2));
  cdp.ws.close();
  chrome.proc.kill();
  await sleep(300);
  rmSync(chrome.profile, { recursive: true, force: true });
  return failures;
}

main().then((f) => process.exit(f ? 1 : 0), (e) => { console.error(`error: ${e.message}`); process.exit(2); });
