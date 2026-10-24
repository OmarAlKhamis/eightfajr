#!/usr/bin/env node
// Builds client/public/data/cities.json from GeoNames (cities with population > 15k).
//
//   node script/build-cities.mjs            # downloads into script/.geonames/ (gitignored), writes JSON
//   node script/build-cities.mjs --offline  # reuse previously downloaded files
//
// Output: a compact array of rows [name, asciiName, arabicName, countryCode,
// admin1Name, lat, lng, timezone, population]. GeoNames data is CC BY 4.0
// (https://www.geonames.org) — attribution is shown on the privacy page.
//
// The downloaded archive is untrusted input: it is written to its own directory,
// parsed as text only, and never executed.

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const downloadDir = join(here, ".geonames");
const outFile = join(root, "client", "public", "data", "cities.json");
const offline = process.argv.includes("--offline");

const SOURCES = {
  cities: "https://download.geonames.org/export/dump/cities15000.zip",
  admin1: "https://download.geonames.org/export/dump/admin1CodesASCII.txt",
};

async function download(url, dest) {
  if (offline && existsSync(dest)) return;
  process.stdout.write(`↓ ${url}\n`);
  const res = await fetch(url, { headers: { "user-agent": "fajr-eight-build/1.0" } });
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

// Minimal ZIP reader (single deflate/stored entry is all we need).
function unzipFirstTxt(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip file");
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = buf.readUInt16LE(eocd + 10);
  let p = cdOffset;
  for (let i = 0; i < entries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.endsWith(".txt")) continue;
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) return data.toString("utf8");
    if (method === 8) return inflateRawSync(data).toString("utf8");
    throw new Error(`unsupported zip method ${method}`);
  }
  throw new Error("no .txt entry in zip");
}

const ARABIC = /[؀-ۿ]/;

// GeoNames' alternate names are untagged, so the heuristic below sometimes picks
// a transliteration. Hand-checked spellings for the cities most of our users live in.
const ARABIC_OVERRIDES = {
  Mecca: "مكة المكرمة",
  "Makkah al Mukarramah": "مكة المكرمة",
  Medina: "المدينة المنورة",
  Amman: "عمّان",
  Istanbul: "إسطنبول",
  Jerusalem: "القدس",
  Tehran: "طهران",
  Manama: "المنامة",
  Sanaa: "صنعاء",
  Khartoum: "الخرطوم",
  Tunis: "تونس",
  Algiers: "الجزائر",
  Rabat: "الرباط",
  Casablanca: "الدار البيضاء",
  Beirut: "بيروت",
  Damascus: "دمشق",
  Tripoli: "طرابلس",
  Baghdad: "بغداد",
  Dammam: "الدمام",
  "Ta'if": "الطائف",
  Abha: "أبها",
  Tabuk: "تبوك",
  Buraydah: "بريدة",
  "Al Khubar": "الخبر",
  Khobar: "الخبر",
  "Al Jubayl": "الجبيل",
  "Ha'il": "حائل",
  Najran: "نجران",
  Jizan: "جازان",
  Jazan: "جازان",
  Yanbu: "ينبع",
  "Al Hufuf": "الهفوف",
  Sharjah: "الشارقة",
  Ajman: "عجمان",
  "Al Ain": "العين",
  Salalah: "صلالة",
  Jeddah: "جدة",
  Riyadh: "الرياض",
  Dubai: "دبي",
  "Abu Dhabi": "أبوظبي",
  Doha: "الدوحة",
  "Kuwait City": "الكويت",
  Muscat: "مسقط",
  Cairo: "القاهرة",
  Alexandria: "الإسكندرية",
  London: "لندن",
  Paris: "باريس",
  Berlin: "برلين",
  "New York City": "نيويورك",
  "Los Angeles": "لوس أنجلوس",
  Toronto: "تورونتو",
  "Kuala Lumpur": "كوالالمبور",
  Jakarta: "جاكرتا",
  Karachi: "كراتشي",
  Lahore: "لاهور",
  Islamabad: "إسلام آباد",
};
const LATIN_ONLY = /^[\u0000-ɏ\s'’.\-()]+$/;

function pickArabic(alternates) {
  if (!alternates) return "";
  // Prefer a short, single-word Arabic alternate; a definite article ("الرياض")
  // beats the bare stem ("رياض"); long descriptive forms ("مدينة ...") lose.
  const candidates = alternates
    .split(",")
    .map((s) => s.trim().replace(/[ً-ْٰـ]/g, "")) // drop tashkeel/tatweel
    .filter((s) => ARABIC.test(s) && s.length <= 30 && !/\d/.test(s));
  if (candidates.length === 0) return "";
  // Alef maqsura endings ("دبى") are usually Persian/Urdu spellings; nudge towards "دبي".
  const score = (s) => s.split(/\s+/).length * 10 + s.length - (s.startsWith("ال") ? 5 : 0) + (/ى$/.test(s) ? 2 : 0);
  candidates.sort((a, b) => score(a) - score(b));
  return candidates[0];
}

async function main() {
  mkdirSync(downloadDir, { recursive: true });
  mkdirSync(dirname(outFile), { recursive: true });
  const zipPath = join(downloadDir, "cities15000.zip");
  const admin1Path = join(downloadDir, "admin1CodesASCII.txt");
  await download(SOURCES.cities, zipPath);
  await download(SOURCES.admin1, admin1Path);

  const admin1 = new Map();
  for (const line of readFileSync(admin1Path, "utf8").split("\n")) {
    const [code, name] = line.split("\t");
    if (code && name) admin1.set(code, name);
  }

  const txt = unzipFirstTxt(readFileSync(zipPath));
  const rows = [];
  for (const line of txt.split("\n")) {
    if (!line) continue;
    const f = line.split("\t");
    // 1 name, 2 asciiname, 3 alternatenames, 4 lat, 5 lng, 8 country, 10 admin1, 14 population, 17 timezone
    const name = f[1];
    const ascii = f[2] && LATIN_ONLY.test(f[2]) ? f[2] : f[1];
    const lat = Number(f[4]);
    const lng = Number(f[5]);
    const cc = f[8];
    const pop = Number(f[14]) || 0;
    const tz = f[17];
    if (!name || !cc || !tz || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const a1 = admin1.get(`${cc}.${f[10]}`) ?? "";
    rows.push([name, ascii === name ? "" : ascii, ARABIC_OVERRIDES[name] ?? pickArabic(f[3]), cc, a1, Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4, tz, pop]);
  }
  rows.sort((a, b) => b[8] - a[8]);
  const json = JSON.stringify({ source: "GeoNames cities15000 (CC BY 4.0)", builtAt: new Date().toISOString().slice(0, 10), rows });
  writeFileSync(outFile, json);
  const withArabic = rows.filter((r) => r[2]).length;
  console.log(`✓ ${rows.length} cities (${withArabic} with Arabic names) → ${outFile} (${(json.length / 1e6).toFixed(2)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
