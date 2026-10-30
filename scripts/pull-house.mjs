#!/usr/bin/env node
// Takes a house saved in the editor back into houses/<id>.yaml (comments in the file
// are lost). Settings from .deploy.env: HOMESLICE_URL, HOMESLICE_TOKEN_FILE.
// Usage: node scripts/pull-house.mjs [house id, default home]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { stringify } from "yaml";

const root = resolve(import.meta.dirname, "..");
const env = Object.fromEntries(
  (existsSync(`${root}/.deploy.env`) ? readFileSync(`${root}/.deploy.env`, "utf8") : "")
    .split("\n").filter((l) => l.includes("=")).map((l) => l.split(/=(.*)/s).slice(0, 2)),
);
const url = (process.env.HOMESLICE_URL ?? env.HOMESLICE_URL)?.replace(/^http/, "ws") + "/api/websocket";
const tokenFile = (process.env.HOMESLICE_TOKEN_FILE ?? env.HOMESLICE_TOKEN_FILE ?? "").replace(/^~/, homedir());
const house = process.argv[2] ?? "home";
const token = readFileSync(tokenFile, "utf8").trim();

const ws = new WebSocket(url);
const model = await new Promise((resolveModel, reject) => {
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: token }));
    else if (msg.type === "auth_ok") ws.send(JSON.stringify({ id: 1, type: "homeslice/model", house }));
    else if (msg.type === "auth_invalid") reject(new Error(msg.message));
    else if (msg.type === "result") msg.success ? resolveModel(msg.result) : reject(new Error(msg.error.message));
  };
  ws.onerror = () => reject(new Error(`cannot connect to ${url}`));
});
ws.close();
const file = `${root}/houses/${house}.yaml`;
writeFileSync(file, stringify(model, { flowCollectionPadding: false, lineWidth: 120 }));
console.log(`wrote ${file}`);
