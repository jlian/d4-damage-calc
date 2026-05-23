// Reference smoke test: verifies our calc matches Avarilyn's spreadsheet ALL CLASSES tab
// when the same numerical inputs are provided.
//
// The spreadsheet's example has both 1H and 2H weapon affixes filled simultaneously
// (a non-physical UX choice). We replicate that here by stuffing all the equivalent
// affixes onto the 2H wep1 slot.
//
// The spreadsheet also bakes the 20% vulnerable baseline into its VDM bucket and
// expects you to "always be vulnerable". Our calc separates the 1.2 baseline and only
// applies it for vulnerable scenarios. So we set enemyDamageFactor = 0.2 (matching, this is (1-R) where R=0.8) and target
// a non-vulnerable scenario, then add 0.2 multiplier manually as part of expected.
//
// Usage: `npx tsx src/calc.test.ts`. Exits 0 on pass, 1 on fail.

import { type Build, scenarioDamage, DEFAULT_BUILD } from './calc';

function close(a: number, b: number, pct = 0.5): boolean {
  if (a === 0 && b === 0) return true;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) * 100 < pct;
}

function makeReferencePaladin(): Build {
  // Replicate Avarilyn's example: stuff every 1H + 2H affix onto a class-valid 2H wep1 slot
  // since our app doesn't allow simultaneous 1H + 2H equip.
  const b: Build = {
    ...DEFAULT_BUILD,
    classId: 'Paladin',
    baseMainStat: 485,
    extraMainStat: 500,
    skillDamagePct: 0.45,    // rank-1 base; calc applies step formula at totalSkillRanks=29 to get 1.8225
    totalSkillRanks: 29,
    baseCritChance: 1.0,         // overcapped in example
    enemyDamageFactor: 0.2,
    disableCrit: false,
    additiveLines: DEFAULT_BUILD.additiveLines.map(l => ({ ...l })),
    extraAdditive: [],
    extraMultipliers: [],
    slots: [
      { id: 'helm',   name: 'Helm',   affixes: [
        { bucket: 'ADDITIVE', value: 2.127 },
        { bucket: 'ADDITIVE', value: 1.0 },
        { bucket: 'ADDITIVE', value: 1.89 },
      ] },
      { id: 'chest',  name: 'Chest',  affixes: [{ bucket: 'MAINSTAT', value: 392 }] },
      { id: 'pants',  name: 'Pants',  affixes: [] },
      { id: 'boots',  name: 'Boots',  affixes: [{ bucket: 'MAINSTAT', value: 151 }] },
      { id: 'gloves', name: 'Gloves', affixes: [
        { bucket: 'CSDM', value: 0.63 }, { bucket: 'VDM', value: 0.35 }, { bucket: 'CRITCHANCE', value: 0.106 },
      ]},
      { id: 'amulet', name: 'Amulet', affixes: [
        { bucket: 'VDM', value: 0.35 }, { bucket: 'CRITCHANCE', value: 0.106 },
      ]},
      { id: 'ring1', name: 'Ring 1', affixes: [
        { bucket: 'CSDM', value: 0.31 }, { bucket: 'VDM', value: 0.18 }, { bucket: 'CRITCHANCE', value: 0.063 },
      ]},
      { id: 'ring2', name: 'Ring 2', affixes: [
        { bucket: 'CSDM', value: 0.31 }, { bucket: 'VDM', value: 0.18 }, { bucket: 'CRITCHANCE', value: 0.063 },
      ]},
      { id: 'wep1', name: 'Weapon 1', weaponTypeId: '2h_polearm', affixes: [
        // Combined 1H+1H+2H affixes from the spreadsheet's filled example
        { bucket: 'CSDM', value: 0.5 + 0.5 + 1.0 },          // 1H wep1 + 1H wep2 + 2H
        { bucket: 'ALLM', value: 0.25 },                       // 2H ALLM
        { bucket: 'MAINSTAT', value: 225 + 225 + 450 },        // both 1H + 2H mainstat
        { bucket: 'ADDITIVE', value: 1.2 },                    // 2H temper
        { bucket: 'WEPDMG', value: 400 },                      // 2H wep roll
        { bucket: 'GEM', value: 0.24 + 0.24 + 0.48 },          // 1H+1H+2H gems
      ]},
      { id: 'wep2', name: 'Weapon 2', weaponTypeId: 'none', affixes: [] },
    ],
  };
  // Set additive lines to match the sheet (close/elites/healthy lines were removed from defaults;
  // their additive values are now bundled into a single ADDITIVE affix below to preserve the reference total).
  const lines: Record<string, number> = {
    vulnerable: 0.31, all: 2.43, primaryElem: 3.8, elites: 2.04,
  };
  for (const id in lines) {
    const l = b.additiveLines.find(x => x.id === id);
    if (l) l.value = lines[id];
  }
  // Stuff removed conditional lines (close, healthy) as an ADDITIVE affix on the helm so the bucket total matches the sheet.
  const helm = b.slots.find(s => s.id === 'helm');
  if (helm) helm.affixes.push({ bucket: 'ADDITIVE', value: 0.18 + 0.625 });
  return b;
}

function runReferenceTest(): boolean {
  const b = makeReferencePaladin();
  // Construct a scenario with all conditional flags ON (matching spreadsheet's "everything always" assumption)
  // and vulnerable = false (since spreadsheet bakes 1.2 into VDM bucket; we don't double-apply).
  // We then divide expected by 1.2 to compare on the same basis.
  // Easier approach: turn vulnerable ON, and divide by 1.2 to remove our extra baseline.
  const fullCondScenario = { id: 'all', label: 'all conditions', conditions: { vulnerable: true, close: true, distant: false, elites: true, cc: false, healthy: true } } as any;
  const dmg = scenarioDamage(b, fullCondScenario);
  const expected = 3_548_287.128 * 1.2; // sheet × 1.2 baseline (we apply baseline, sheet doesn't)
  const ok = close(dmg, expected, 0.5);
  console.log(`Tool dmg (vuln + close + elites + healthy, crit):  ${dmg.toFixed(2)}`);
  console.log(`Expected (sheet U24 × 1.2):                         ${expected.toFixed(2)}`);
  console.log(`Match within 0.5%: ${ok ? '✅' : '❌'}`);
  return ok;
}

export { runReferenceTest };

// ---- Skill weapon slot test (Reddit feedback #2) ----
// Verifies that:
//   - skillWeaponSlotId = null (auto) sums baseDamage across all equipped weapons (legacy behavior).
//   - skillWeaponSlotId = 'wepN' uses only that slot's baseDamage + its own WEPDMG affixes.
//   - WEPDMG_PCT and other global affixes still apply in both modes (sanity: speed is averaged in both modes).
import { computeWeaponDamage, weaponTypeById } from './calc';

function runSkillWeaponSlotTest(): boolean {
  // Two-weapon Necromancer build: 2H scythe in wep1 (4607), 1H sword in wep2 (1884). Necro has weaponSlots=2.
  const b: Build = {
    ...DEFAULT_BUILD,
    classId: 'Necromancer',
    skillWeaponSlotId: null,
    slots: [
      ...DEFAULT_BUILD.slots.filter(s => !s.id.startsWith('wep')).map(s => ({ ...s, affixes: [] })),
      { id: 'wep1', name: 'Weapon 1', weaponTypeId: '2h_scythe', affixes: [{ bucket: 'WEPDMG', value: 100 }] },
      { id: 'wep2', name: 'Weapon 2', weaponTypeId: '1h_sword',  affixes: [{ bucket: 'WEPDMG', value: 50  }] },
      { id: 'wep3', name: 'Weapon 3', weaponTypeId: 'none',      affixes: [] },
      { id: 'wep4', name: 'Weapon 4', weaponTypeId: 'none',      affixes: [] },
    ],
  };

  const scythe = weaponTypeById('2h_scythe').baseDamage; // 4607
  const sword  = weaponTypeById('1h_sword').baseDamage;  // 1884

  // Auto: 4607 + 100 + 1884 + 50 = 6641
  const auto = computeWeaponDamage(b);
  const expectedAuto = scythe + 100 + sword + 50;
  const okAuto = auto.dmg === expectedAuto;
  console.log(`Auto sum: got ${auto.dmg}, expected ${expectedAuto} ${okAuto ? '\u2705' : '\u274C'}`);

  // Explicit wep1 (scythe + 100 only): 4707. wep2's +50 WEPDMG is excluded.
  const b1: Build = { ...b, skillWeaponSlotId: 'wep1' };
  const only1 = computeWeaponDamage(b1);
  const expected1 = scythe + 100;
  const ok1 = only1.dmg === expected1;
  console.log(`Explicit wep1: got ${only1.dmg}, expected ${expected1} ${ok1 ? '\u2705' : '\u274C'}`);

  // Explicit wep2 (sword + 50 only): 1934.
  const b2: Build = { ...b, skillWeaponSlotId: 'wep2' };
  const only2 = computeWeaponDamage(b2);
  const expected2 = sword + 50;
  const ok2 = only2.dmg === expected2;
  console.log(`Explicit wep2: got ${only2.dmg}, expected ${expected2} ${ok2 ? '\u2705' : '\u274C'}`);

  // Speed should still average across BOTH equipped weapons in either mode (the displayed attack rate
  // in-game reflects what you're swinging, not the skill slot). 2h_scythe=0.9, 1h_sword=1.1, avg=1.0.
  const expectedSpeed = (0.9 + 1.1) / 2;
  const okSpeed = Math.abs(auto.speed - expectedSpeed) < 1e-9 && Math.abs(only1.speed - expectedSpeed) < 1e-9;
  console.log(`Speed avg preserved: ${okSpeed ? '\u2705' : '\u274C'}`);

  // Barbarian dual-2H bonus should only fire in auto mode.
  const barb: Build = {
    ...DEFAULT_BUILD,
    classId: 'Barbarian',
    skillWeaponSlotId: null,
    slots: [
      ...DEFAULT_BUILD.slots.filter(s => !s.id.startsWith('wep')).map(s => ({ ...s, affixes: [] })),
      { id: 'wep1', name: 'Weapon 1', weaponTypeId: '2h_mace',   affixes: [] },
      { id: 'wep2', name: 'Weapon 2', weaponTypeId: '2h_sword',  affixes: [] },
      { id: 'wep3', name: 'Weapon 3', weaponTypeId: 'none',      affixes: [] },
      { id: 'wep4', name: 'Weapon 4', weaponTypeId: 'none',      affixes: [] },
    ],
  };
  const barbAuto = computeWeaponDamage(barb); // (4607 + 4146) * 2 = 17506
  const barbExpl = computeWeaponDamage({ ...barb, skillWeaponSlotId: 'wep1' }); // just 4607, no x2
  const okBarb = barbAuto.dmg === (4607 + 4146) * 2 && barbExpl.dmg === 4607;
  console.log(`Barb dual-2H bonus auto-only: auto=${barbAuto.dmg}, explicit=${barbExpl.dmg} ${okBarb ? '\u2705' : '\u274C'}`);

  return okAuto && ok1 && ok2 && okSpeed && okBarb;
}

export { runSkillWeaponSlotTest };

// Run when invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const ok1 = runReferenceTest();
  console.log('---');
  const ok2 = runSkillWeaponSlotTest();
  process.exit(ok1 && ok2 ? 0 : 1);
}
