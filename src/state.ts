import pako from 'pako';
import { DEFAULT_BUILD, DEFAULT_ADDITIVE_LINES, cloneDefaultLines, BUCKET_META, CLASSES, WEAPON_TYPES, type Build, type AdditiveLine } from './calc';

const STORAGE_KEY = 'd4bc.build';

// Current schema version. Bump whenever we change how saved data should be interpreted on load.
// v2: shield innate +100% Weapon Damage Bonus is now auto-applied by the calc; strip any legacy
//     manual WEPDMG_PCT entry of +1.0 from shield slots to avoid double-counting.
const SCHEMA_VERSION = 2;

const LEGACY_WEAPON_IDS: Record<string, string> = { '1h_focus': 'focus' };

// AdditiveLine has a function field that doesn't survive JSON. Serialize as {id,value} pairs.
function lineToSerial(l: AdditiveLine) { return { id: l.id, value: l.value }; }
function rehydrateLines(serial: { id: string; value: number }[] | undefined): AdditiveLine[] {
  const out = cloneDefaultLines();
  if (Array.isArray(serial)) {
    const known = new Set(DEFAULT_ADDITIVE_LINES.map(d => d.id));
    for (const s of serial) {
      if (!s || typeof s.id !== 'string' || !known.has(s.id)) continue;
      const target = out.find(l => l.id === s.id);
      if (target) target.value = validNumber(s.value, 0);
    }
  }
  return out;
}

function buildToSerial(b: Build): any {
  return { schemaVersion: SCHEMA_VERSION, ...b, additiveLines: b.additiveLines.map(lineToSerial), snapshot: b.snapshot ? buildToSerial(b.snapshot) : null };
}

function migrateSlots(slotsIn: any): import('./calc').Slot[] {
  const defaults = DEFAULT_BUILD.slots;
  const incoming = Array.isArray(slotsIn) ? slotsIn : [];
  const knownWeaponIds = new Set(WEAPON_TYPES.map(w => w.id));
  return defaults.map(def => {
    const found = incoming.find(s => s && s.id === def.id);
    if (!found) return { ...def, affixes: [] };
    const affixes = Array.isArray(found.affixes)
      ? found.affixes
          .filter((a: any) => a && typeof a.bucket === 'string' && a.bucket in BUCKET_META)
          .map((a: any) => ({ bucket: a.bucket, value: validNumber(a.value, 0), ...(typeof a.label === 'string' ? { label: a.label } : {}) }))
      : [];
    const isWeapon = def.id.startsWith('wep');
    const weaponTypeId = isWeapon
      ? (() => {
          const rawId = typeof found.weaponTypeId === 'string' ? found.weaponTypeId : 'none';
          const normalized = LEGACY_WEAPON_IDS[rawId] ?? rawId;
          return knownWeaponIds.has(normalized) ? normalized : 'none';
        })()
      : undefined;
    return {
      id: def.id, name: def.name, affixes,
      ...(isWeapon ? { weaponTypeId } : {}),
    };
  });
}

function validNumber(n: any, fallback = 0): number {
  const x = typeof n === 'number' && isFinite(n) ? n : (typeof n === 'string' ? parseFloat(n) : NaN);
  return isFinite(x) ? x : fallback;
}

// validStringList: kept for future use; currently unused after dropping extraMultipliers/extraAdditive
// @ts-ignore unused
function validStringList(arr: any, fields: string[]): any[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter(it => it && typeof it === 'object' && fields.every(f => f in it));
}

function reconcileWeaponClass(slots: import('./calc').Slot[], classId: string): void {
  for (const slot of slots) {
    if (!slot.weaponTypeId || slot.weaponTypeId === 'none') continue;
    const wt = WEAPON_TYPES.find(w => w.id === slot.weaponTypeId);
    if (wt?.allowedClasses && !wt.allowedClasses.includes(classId as any)) {
      slot.weaponTypeId = 'none';
    }
  }
}

function migrateSlotsAndExtras(j: any): import('./calc').Slot[] {
  return migrateSlots(j.slots);
}

function serialToBuild(j: any): Build {
  if (!j || typeof j !== 'object') throw new Error('not an object');
  const knownClass = typeof j.classId === 'string' && CLASSES.some(c => c.id === j.classId);
  const incomingVersion = typeof j.schemaVersion === 'number' ? j.schemaVersion : 1;
  const out: Build = {
    ...DEFAULT_BUILD,
    classId: knownClass ? j.classId : DEFAULT_BUILD.classId,
    baseMainStat: validNumber(j.baseMainStat, DEFAULT_BUILD.baseMainStat),
    extraMainStat: validNumber(j.extraMainStat, 0),
    skillName: typeof j.skillName === 'string' ? j.skillName : DEFAULT_BUILD.skillName,
    // Migrate old skillCoefL1/skillRanks/extraSkillRanks fields
    skillDamagePct: validNumber(j.skillDamagePct ?? j.skillCoefL1, DEFAULT_BUILD.skillDamagePct),
    totalSkillRanks: validNumber(j.totalSkillRanks ?? ((j.skillRanks ?? 0) + (j.extraSkillRanks ?? 0)), DEFAULT_BUILD.totalSkillRanks),
    baseCritChance: validNumber(j.baseCritChance, DEFAULT_BUILD.baseCritChance),
    attackSpeedBonus: validNumber(j.attackSpeedBonus, 0),
    weaponSpeedOverride: j.weaponSpeedOverride == null ? null : validNumber(j.weaponSpeedOverride, 0),
    disableCrit: !!j.disableCrit,
    enemyDamageFactor: validNumber(j.enemyDamageFactor, 0.2),
    skillWeaponSlotId: (typeof j.skillWeaponSlotId === 'string' && /^wep\d+$/.test(j.skillWeaponSlotId)) ? j.skillWeaponSlotId : null,
    slots: migrateSlotsAndExtras(j),
    additiveLines: rehydrateLines(Array.isArray(j.additiveLines) ? j.additiveLines : undefined),
    snapshot: j.snapshot ? safeSerialToBuild(j.snapshot) : null,
  };
  reconcileWeaponClass(out.slots, out.classId);
  // v1 -> v2: shield innate +100% Weapon Damage Bonus is now baked into the calc.
  // Strip a single legacy WEPDMG_PCT of +1.0 from any shield slot to avoid double-counting.
  // (Conservative heuristic: only the first +1.0 entry per shield slot is removed; any extra
  // user-added WEPDMG_PCT affixes stay.)
  if (incomingVersion < 2) {
    for (const slot of out.slots) {
      if (slot.weaponTypeId !== 'shield') continue;
      const idx = slot.affixes.findIndex(a => a.bucket === 'WEPDMG_PCT' && Math.abs(a.value - 1.0) < 1e-9);
      if (idx >= 0) slot.affixes.splice(idx, 1);
    }
  }
  return out;
}

function safeSerialToBuild(j: any): Build | null {
  try { return serialToBuild(j); } catch { return null; }
}

export function saveLocal(b: Build) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(buildToSerial(b))); } catch {}
}

export function loadLocal(): Build | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return serialToBuild(JSON.parse(raw));
  } catch { return null; }
}

export function encodeHash(b: Build): string {
  const json = JSON.stringify(buildToSerial(b));
  const compressed = pako.deflate(json);
  let bin = '';
  for (let i = 0; i < compressed.length; i++) bin += String.fromCharCode(compressed[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeHash(hash: string): Build | null {
  try {
    let b64 = hash.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = pako.inflate(bytes, { to: 'string' });
    return serialToBuild(JSON.parse(json));
  } catch { return null; }
}

export function exportJson(b: Build): string {
  return JSON.stringify(buildToSerial(b), null, 2);
}
export function importJson(text: string): Build | null {
  try {
    const parsed = JSON.parse(text);
    return serialToBuild(parsed);
  } catch { return null; }
}
export function importJsonObject(obj: any): Build | null {
  return safeSerialToBuild(obj);
}

export function loadInitialBuild(): Build {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash) {
    const b = decodeHash(hash);
    if (b) return b;
  }
  return loadLocal() ?? defaultBuild();
}

export function defaultBuild(): Build { return { ...DEFAULT_BUILD, additiveLines: cloneDefaultLines(), slots: structuredClone(DEFAULT_BUILD.slots), snapshot: null }; }

export function cloneBuild(b: Build): Build {
  return { ...b, additiveLines: b.additiveLines.map(l => ({ ...l })), slots: structuredClone(b.slots), snapshot: b.snapshot ? cloneBuild(b.snapshot) : null };
}

export function persist(b: Build) {
  saveLocal(b);
  const h = encodeHash(b);
  history.replaceState(null, '', '#' + h);
}

export function buildShareUrl(b: Build): string {
  const h = encodeHash(b);
  const base = window.location.origin + window.location.pathname + window.location.search;
  return base + '#' + h;
}
