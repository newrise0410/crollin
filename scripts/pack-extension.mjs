#!/usr/bin/env node
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(root, "extension");
const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
const outDir = path.join(root, "dist");
const zipName = `crollin-extension-${manifest.version}.zip`;
const zipPath = path.join(outDir, zipName);

mkdirSync(outDir, { recursive: true });

execFileSync("zip", ["-r", "-q", zipPath, "."], {
  cwd: extensionDir,
  stdio: "inherit"
});

const bytes = statSync(zipPath).size;
process.stdout.write(`${zipPath} (${bytes.toLocaleString()} bytes)\n`);
process.stdout.write("Chrome: chrome://extensions → 개발자 모드 → 압축해제된 확장 프로그램을 로드 → extension/\n");
process.stdout.write("또는 위 zip을 '압축된 파일 로드'로 설치합니다.\n");
