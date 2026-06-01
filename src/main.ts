import './style.css';
import 'katex/dist/katex.min.css';
import katex from 'katex';
import samplePaladin from './sample-paladin.json';
import {
  calc, classFor, CLASSES, BUCKET_META, BUCKET_ORDER,
  weightFor, scenarioDamage, scenarioDamageNoCrit,
  additiveForScenario, critOnlyAdditive,
  WEAPON_TYPES, weaponTypeById,
  type Build, type Bucket, type Slot,
} from './calc';
import { loadInitialBuild, persist, exportJson, importJson, cloneBuild, buildShareUrl, importJsonObject } from './state';
import { FIELD_HELP, helpIcon } from './help';

let build: Build = loadInitialBuild();

const fmtPct = (n: number, digits = 2) => (n * 100).toFixed(digits) + '%';
const fmtNum = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits });
const fmtBigNum = (n: number) => {
  if (!isFinite(n) || n === 0) return '0';
  if (n >= 1e15) return (n / 1e15).toFixed(2) + 'Q';   // quadrillions
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';   // trillions
  if (n >= 1e9)  return (n / 1e9).toFixed(2)  + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2)  + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(2)  + 'K';
  return fmtNum(n, 0);
};
const stripTrailingZero = (s: string) => s.includes('.') ? s.replace(/\.?0+$/, '') : s;

// Compare two builds for the "is the saved version still in sync?" indicator.
// We strip the nested `snapshot` field on both sides and JSON-compare; AdditiveLine.applies
// is a function and won't survive JSON, but cloneBuild preserves it, and JSON.stringify just drops it from both,
// so the comparison still works for the meaningful state.
function buildsEqualForCompare(a: Build, b: Build): boolean {
  try {
    const norm = (x: Build) => JSON.stringify({ ...x, snapshot: null }, (_k, v) => typeof v === 'function' ? undefined : v);
    return norm(a) === norm(b);
  } catch { return false; }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k.startsWith('on') && typeof attrs[k] === 'function') (e as any)[k.toLowerCase()] = attrs[k];
    else if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, String(attrs[k]));
  }
  for (const c of children) if (c != null) e.append(c as any);
  return e;
}

function inputCls() { return 'bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-200 focus:outline-none focus:border-amber-600'; }
function sectionCard(title: string, subtitle?: string, headerRight?: HTMLElement) {
  const card = el('section', { class: 'bg-zinc-900/50 border border-zinc-800 rounded-lg p-4' });
  const headerRow = el('div', { class: 'flex items-start justify-between gap-3 mb-1' });
  headerRow.append(el('h2', { class: 'text-sm font-semibold text-zinc-300 uppercase tracking-wide' }, title));
  if (headerRight) headerRow.append(headerRight);
  card.append(headerRow);
  if (subtitle) card.append(el('p', { class: 'text-xs text-zinc-500 mb-3' }, subtitle));
  else card.append(el('div', { class: 'mb-3' }));
  return card;
}

function pctInput(getValue: () => number, setValue: (v: number) => void, opts: { step?: number; w?: string } = {}) {
  const inp = el('input', { type: 'number', step: opts.step ?? 1, class: inputCls() + ' ' + (opts.w ?? 'w-20') + ' text-right' }) as HTMLInputElement;
  inp.value = stripTrailingZero((getValue() * 100).toFixed(2));
  inp.addEventListener('input', () => {
    const raw = parseFloat(inp.value);
    setValue(isNaN(raw) ? 0 : raw / 100);
    afterInput();
  });
  return inp;
}

function numInput(getValue: () => number, setValue: (v: number) => void, opts: { step?: number; w?: string } = {}) {
  const inp = el('input', { type: 'number', step: opts.step ?? 1, class: inputCls() + ' ' + (opts.w ?? 'w-20') + ' text-right' }) as HTMLInputElement;
  inp.value = String(getValue());
  inp.addEventListener('input', () => {
    const raw = parseFloat(inp.value);
    setValue(isNaN(raw) ? 0 : raw);
    afterInput();
  });
  return inp;
}

function textInput(getValue: () => string, setValue: (v: string) => void, opts: { w?: string; placeholder?: string } = {}) {
  const inp = el('input', { type: 'text', class: inputCls() + ' ' + (opts.w ?? 'flex-1'), placeholder: opts.placeholder ?? '' }) as HTMLInputElement;
  inp.value = getValue();
  inp.addEventListener('input', () => { setValue(inp.value); afterInput(); });
  return inp;
}

function field(label: string, control: HTMLElement, helpKey?: string) {
  const wrap = el('label', { class: 'block' });
  const labelRow = el('div', { class: 'text-xs text-zinc-500 mb-1 flex items-center' });
  labelRow.append(label);
  if (helpKey) {
    const icon = helpIcon(helpKey);
    if (icon) labelRow.append(icon);
  }
  wrap.append(labelRow);
  control.classList.add('w-full');
  wrap.append(control);
  return wrap;
}

function afterInput() {
  persist(build);
  refreshOutputs();
}

function mount() {
  const root = document.getElementById('app')!;
  root.innerHTML = '';
  root.append(renderHeader());
  const main = el('main', { class: 'max-w-6xl mx-auto p-4 grid lg:grid-cols-[1fr_minmax(320px,400px)] gap-6' });
  root.append(main);

  const left = el('div', { class: 'space-y-6' });
  left.append(nakedBaselineCard());
  left.append(slotsCard());
  left.append(charmsCard());
  left.append(glyphsCard());
  left.append(paragonContributionsCard());
  main.append(left);

  const right = el('div', { id: 'outputs', class: 'space-y-6 lg:sticky lg:top-20 lg:self-start' });
  main.append(right);
  refreshOutputs();
  persist(build);

  // Footer
  const footer = el('footer', { id: 'formula-footer', class: 'max-w-6xl mx-auto p-4 mt-8 border-t border-zinc-900' });
  footer.append(formulaCard());
  root.append(footer);
}

function refreshOutputs() {
  // Header holds Save Build / Restore Saved, both of which depend on dirty state vs the saved build.
  // Re-render it here so live edits (afterInput -> refreshOutputs) update the dirty dot immediately
  // instead of waiting for a full mount(). Header is replaced wholesale; cheap enough.
  const headerHost = document.getElementById('app');
  if (headerHost) {
    const oldHeader = headerHost.querySelector('header.app-header');
    if (oldHeader) {
      const newHeader = renderHeader();
      oldHeader.replaceWith(newHeader);
    }
  }
  const right = document.getElementById('outputs');
  if (right) {
    right.innerHTML = '';
    right.append(scenariosCard());
    right.append(bucketsCard());
    right.append(breakdownCard());
    right.append(statsCard());
  }
  const footer = document.getElementById('formula-footer');
  if (footer) {
    footer.innerHTML = '';
    footer.append(formulaCard());
  }
}

// ---------- Header ----------
function renderHeader() {
  return el('header', { class: 'app-header border-b border-zinc-800 px-4 py-3 sticky top-0 bg-zinc-950/95 backdrop-blur z-10' },
    el('div', { class: 'max-w-6xl mx-auto flex flex-wrap items-center gap-3 justify-between' },
      el('div', { class: 'flex items-center gap-3' },
        el('span', { class: 'text-2xl' }, '⚔️'),
        el('div', {},
          el('h1', { class: 'text-lg font-bold leading-tight' }, 'Diablo 4 (Lord of Hatred) Damage Calculator'),
          el('div', { class: 'text-[10px] text-zinc-500 leading-tight' },
            'Calculator design + math by ',
            Object.assign(el('a', { href: 'https://www.youtube.com/@avarilyn', target: '_blank', class: 'text-amber-400 hover:underline' }), { textContent: 'Avarilyn' }),
            ' · web port by ',
            Object.assign(el('a', { href: 'https://github.com/jlian', target: '_blank', class: 'text-amber-400 hover:underline' }), { textContent: 'jlian' }),
          ),
        ),
      ),
      el('div', { class: 'flex items-center gap-2 flex-wrap' },
        snapshotBtn(), restoreSnapshotBtn(), loadSampleBtn(), jsonBtn(), copyShareBtn(), resetBtn(),
      ),
    ),
  );
}

// ---------- Card 1: Baseline Stats (class + skill + stats sheet numbers) ----------
function nakedBaselineCard() {
  const cls = classFor(build);
  const card = sectionCard('Baseline Stats', 'Strip all gear (armor, jewelry, weapons, charms, seal) so the numbers below reflect only your level / paragon contribution. Re-equip after you copy the stats sheet values.');

  // Class + skill inputs live at the top, since the user has to be naked to read both these and the stats-sheet numbers below.
  const topGrid = el('div', { class: 'grid grid-cols-2 gap-3 mb-3' });

  const classSel = el('select', { class: inputCls() + ' w-full' }) as HTMLSelectElement;
  for (const c of CLASSES) {
    const opt = el('option', { value: c.id }, `${c.id} (${c.mainStat})`);
    if (c.id === build.classId) opt.setAttribute('selected', '');
    classSel.append(opt);
  }
  classSel.addEventListener('change', () => {
    build.classId = classSel.value as any;
    // Reconcile any equipped weapons whose allowedClasses no longer include this class
    for (const slot of build.slots) {
      if (!slot.weaponTypeId || slot.weaponTypeId === 'none') continue;
      const wt = WEAPON_TYPES.find(w => w.id === slot.weaponTypeId);
      if (wt?.allowedClasses && !wt.allowedClasses.includes(build.classId)) {
        slot.weaponTypeId = 'none';
      }
    }
    // If the previously chosen skill weapon slot is no longer available for this class (fewer slots)
    // or points to a now-empty slot, fall back to Auto so the damage number stays sensible.
    if (build.skillWeaponSlotId) {
      const newCls = classFor(build);
      const idx = parseInt(build.skillWeaponSlotId.slice(3), 10);
      if (!isFinite(idx) || idx < 1 || idx > newCls.weaponSlots) build.skillWeaponSlotId = null;
    }
    persist(build);
    mount();
  });
  topGrid.append(field('Class', classSel, 'class'));
  topGrid.append(field('Skill base damage % (rank 1)', pctInput(() => build.skillDamagePct, v => build.skillDamagePct = v, { step: 1, w: 'w-full' }), 'skillDamagePct'));
  topGrid.append(field('Skill ranks (naked, no gear)', numInput(() => build.totalSkillRanks, v => build.totalSkillRanks = v, { w: 'w-full' }), 'totalSkillRanks'));
  topGrid.append(field(`${cls.mainStat} (naked, incl. paragon)`, numInput(() => build.baseMainStat, v => build.baseMainStat = v, { w: 'w-full' }), 'baseMainStat'));

  // Skill weapon selector. In D4 an active skill consumes a SPECIFIC weapon's base damage
  // (e.g. Hammer of the Ancients uses the 2H bludgeoning slot, not the dual-wielded 1H swords).
  // "Auto" preserves the legacy spreadsheet behavior of summing baseDamage across all equipped weapons,
  // which is correct for most single-weapon classes and keeps existing share URLs unchanged.
  const weaponSlots = build.slots.filter(s => s.id.startsWith('wep'));
  const equippedWeaponSlots = weaponSlots.filter((_s, i) => i < cls.weaponSlots);
  const skillWepSel = el('select', { class: inputCls() + ' w-full', title: 'Which equipped weapon\u2019s base damage drives this skill. \u201CAuto\u201D sums all weapons (legacy behavior, fine for single-weapon classes). Pick a specific slot for skills like Hammer of the Ancients that always use one weapon.' }) as HTMLSelectElement;
  const autoOpt = el('option', { value: '' }, 'Auto (sum all equipped)');
  if (build.skillWeaponSlotId == null) autoOpt.setAttribute('selected', '');
  skillWepSel.append(autoOpt);
  for (const ws of equippedWeaponSlots) {
    const wt = weaponTypeById(ws.weaponTypeId ?? 'none');
    const label = wt.id === 'none' ? `${ws.name} (empty)` : `${ws.name} \u2014 ${wt.label}`;
    const opt = el('option', { value: ws.id }, label);
    if (build.skillWeaponSlotId === ws.id) opt.setAttribute('selected', '');
    skillWepSel.append(opt);
  }
  skillWepSel.addEventListener('change', () => {
    build.skillWeaponSlotId = skillWepSel.value === '' ? null : skillWepSel.value;
    afterInput();
  });
  topGrid.append(field('Skill weapon (drives this skill\u2019s base damage)', skillWepSel, 'skillWeaponSlot'));
  card.append(topGrid);

  // Replace the long single-paragraph subtitle with bullet steps + a reference screenshot
  const help = el('details', { class: 'mb-3 text-xs text-zinc-400' });
  const summary = el('summary', { class: 'cursor-pointer text-zinc-300 select-none' }, '⚠️ Getting the right numbers from the stats sheet');
  help.append(summary);
  const body = el('div', { class: 'mt-2 grid sm:grid-cols-[1fr_auto] gap-3 items-start' });
  const steps = el('ol', { class: 'list-decimal list-inside space-y-1 text-zinc-400' });
  steps.append(
    el('li', {}, 'Strip ', el('strong', { class: 'text-zinc-200' }, 'all'), ' gear (and charms / Horadric Seal). You want pure paragon contribution.'),
    el('li', {}, 'Open the ', el('strong', { class: 'text-zinc-200' }, 'Stats Sheet'), ' (press the ', el('em', { class: 'text-amber-300' }, 'Stats & Materials'), ' button) and switch to the ', el('strong', { class: 'text-zinc-200' }, 'Offensive'), ' tab.'),
    el('li', {}, 'Hover each line. The tooltip has a ', el('strong', { class: 'text-zinc-200' }, 'top'), ' (visible) number and a ', el('strong', { class: 'text-zinc-200' }, 'bottom'), ' line: ',
      el('em', { class: 'text-amber-300' }, '“You have +X% of this stat from items and Paragon.”'),
      ' Copy the bottom number.'),
    el('li', {}, 'The inherent +50% crit damage and +20% vulnerable are already baked into the formula, do not add them.'),
  );
  body.append(steps);
  const fig = el('figure', { class: 'border border-zinc-800 rounded overflow-hidden bg-zinc-950 max-w-[320px]' });
  const img = el('img', { src: import.meta.env.BASE_URL + 'help/offensive-tab-hover.png', alt: 'D4 stats sheet tooltip example', class: 'block w-full h-auto', loading: 'lazy' }) as HTMLImageElement;
  fig.append(img);
  fig.append(el('figcaption', { class: 'text-[10px] text-zinc-500 px-2 py-1' }, 'Hover a stat → read the bottom “+X% from items and Paragon” line.'));
  body.append(fig);
  help.append(body);
  card.append(help);

  // All additive lines, in-game order, no split. Crit chance lives in the same grid as the first row
  // so the inputs all line up consistently.
  const grid = el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2' });
  const critRow = el('div', { class: 'flex items-center gap-2' });
  const critLabel = el('div', { class: 'flex-1 text-xs text-zinc-400 flex items-center' }, 'Crit Chance % (gear + paragon)');
  { const icon = helpIcon('baseCritChance'); if (icon) critLabel.append(icon); }
  critRow.append(critLabel);
  critRow.append(pctInput(() => build.baseCritChance, v => build.baseCritChance = v, { w: 'w-24', step: 0.5 }));
  critRow.append(el('span', { class: 'text-zinc-600 text-xs' }, '%'));
  grid.append(critRow);
  // Friendly label overrides for the additive-line rows (keyed by AdditiveLine.id).
  // Source-of-truth labels in calc.ts match the in-game stats sheet; we add
  // small qualifiers so users know to copy the bottom (+X% from items and Paragon) number.
  const ADDITIVE_LABEL_OVERRIDE: Record<string, string> = {
    crit:        'Crit Damage % (gear + paragon)',
    vulnerable:  'Vulnerable Damage % (additive, gear+paragon)',
    all:         'All Damage %',
    primaryElem: 'Damage with [Element] %',
    overTime:    'Damage Over Time % (DoT mode only)',
    close:       'Damage vs Close %',
    distant:     'Damage vs Distant %',
    elites:      'Damage vs Elites %',
    cc:          'Damage vs Crowd Controlled %',
  };
  for (const line of build.additiveLines) {
    const row = el('div', { class: 'flex items-center gap-2' });
    const labelDiv = el('div', { class: 'flex-1 text-xs text-zinc-400 flex items-center' }, ADDITIVE_LABEL_OVERRIDE[line.id] ?? line.label);
    const icon = helpIcon('add_' + line.id);
    if (icon) labelDiv.append(icon);
    row.append(labelDiv);
    row.append(pctInput(() => line.value, v => line.value = v, { w: 'w-24' }));
    row.append(el('span', { class: 'text-zinc-600 text-xs' }, '%'));
    grid.append(row);
  }
  card.append(grid);

  // Custom additive entries: for additive stat lines that exist on the stats sheet but aren't in our default list (e.g., Rogue's Damage with Imbued, Damage vs Distant)
  const otherAddHeader = el('h4', { class: 'text-xs uppercase tracking-wide text-zinc-500 mt-4 mb-2 flex items-center' }, 'Other additive lines');
  { const icon = helpIcon('add_custom'); if (icon) otherAddHeader.append(icon); }
  card.append(otherAddHeader);
  card.append(el('p', { class: 'text-xs text-zinc-500 mb-2' }, 'For additive damage lines on your in-game stats sheet that aren’t in the default list above (like “Damage vs Distant”, “Damage vs Healthy”, “Damage vs Crowd Controlled”, etc.). Same rule: copy the BOTTOM tooltip number from the stats sheet. Anything you add here is treated as always-on and gets included in the result, even if it’s technically conditional in-game.'));
  const paragonSlot = build.slots.find(s => s.id === 'paragon');
  if (paragonSlot) {
    const customAdds = paragonSlot.affixes.filter(a => a.bucket === 'ADDITIVE');
    customAdds.forEach((a) => {
      const row = el('div', { class: 'flex items-center gap-2 mb-1.5' });
      row.append(textInput(() => a.label ?? '', v => { a.label = v; }, { w: 'flex-1', placeholder: 'e.g. Damage with Imbued' }));
      row.append(pctInput(() => a.value, v => a.value = v, { w: 'w-24' }));
      row.append(el('span', { class: 'text-zinc-600 text-xs' }, '%'));
      const del = el('button', { class: 'text-zinc-500 hover:text-red-400 px-2' }, '✕');
      del.addEventListener('click', () => { paragonSlot.affixes.splice(paragonSlot.affixes.indexOf(a), 1); mount(); });
      row.append(del);
      card.append(row);
    });
    const addBtn = el('button', { class: 'text-xs text-amber-400 hover:text-amber-300 px-2 py-1 rounded border border-amber-700/50 mt-1' }, '+ Add other additive line');
    addBtn.addEventListener('click', () => { paragonSlot.affixes.push({ bucket: 'ADDITIVE' as Bucket, value: 0, label: '' }); mount(); });
    card.append(addBtn);
  }
  return card;
}

// ---------- Card 3: Gear Slots ----------
const CHARM_IDS = new Set(['charm1', 'charm2', 'charm3', 'charm4', 'charm5', 'charm6', 'seal', 'setBonus']);
const GLYPH_IDS = new Set(['glyph1', 'glyph2', 'glyph3', 'glyph4', 'glyph5']);

function slotsCard() {
  const card = sectionCard('Gear Slots',
    'Equipped armor, jewelry, and weapons. Add each item’s affixes (and pick a weapon type on weapon slots). Charms, the seal, glyphs, and the set bonus live in their own cards below.');
  const cls = classFor(build);
  const weaponSlotCount = cls.weaponSlots;
  for (const slot of build.slots) {
    if (slot.id === 'paragon') continue;
    if (CHARM_IDS.has(slot.id)) continue;
    if (GLYPH_IDS.has(slot.id)) continue;
    const wepIdx = slot.id.startsWith('wep') ? parseInt(slot.id.slice(3), 10) : 0;
    if (wepIdx > 0 && wepIdx > weaponSlotCount) continue;
    card.append(slotBlock(slot));
  }
  return card;
}

function charmsCard() {
  const card = sectionCard('Charms, Seal & Set Bonus',
    '6 charm slots, the Horadric Seal, and a dedicated Set Bonus row. Each carries affixes that go into damage buckets. For set bonuses (e.g., 5pc Disciple x500% damage), use the Custom [x]% bucket on the Set Bonus row so it isn\u2019t tied to a specific charm.');
  const order = ['charm1','charm2','charm3','charm4','charm5','charm6','seal','setBonus'];
  for (const id of order) {
    const slot = build.slots.find(s => s.id === id);
    if (slot) card.append(slotBlock(slot));
  }
  return card;
}

function glyphsCard() {
  const card = sectionCard('Glyph Sockets (5 max)',
    'Each glyph has up to 3 sources of damage: the additive bonus (top), additional bonus (often conditional, ignore if not steady-state), and the legendary bonus (bottom). Enter ONLY the legendary bonus here. The additive parts are already in the Baseline Stats card above.');
  const order = ['glyph1','glyph2','glyph3','glyph4','glyph5'];
  for (const id of order) {
    const slot = build.slots.find(s => s.id === id);
    if (slot) card.append(slotBlock(slot));
  }
  return card;
}


// Class-aware reminders for the "Other Buffs & Multipliers" card. These are hints, not values:
// the user must look up the current damage % from their build / patch notes / character sheet.
const CLASS_HINTS: Record<string, string> = {
  Paladin: 'aura damage bonuses (Conviction, etc.), Holy Bolt synergies, charm/seal multipliers not in their own card, and paragon legendary nodes.',
  Barbarian: 'Walking Arsenal stacks, Berserking, Weapon Expertise rank-10 bonuses, Arsenal-swap aspects, and paragon legendary nodes.',
  Druid: 'form-shift damage (Werewolf / Werebear), Spirit Boon damage bonuses, companion buffs, and paragon legendary nodes.',
  Necromancer: 'curse multipliers (Decrepify, Iron Maiden), Book of the Dead sacrifice bonuses, minion buff aspects, and paragon legendary nodes.',
  Rogue: 'Combo Point bonuses, Inner Sight / Preparation effects, Imbuement multipliers, weapon-specific aspects, and paragon legendary nodes.',
  Sorcerer: 'Devastation, Crackling Energy, element-specific multipliers (Aspect of Control etc.), and paragon legendary nodes.',
  Spiritborn: 'Spirit Hall Primary / Secondary bonuses, Resolve / Ferocity stack multipliers, spirit-tag aspects, and paragon legendary nodes.',
  Warlock: 'curse / hex multipliers, summon buffs, and paragon legendary nodes.',
};

function paragonContributionsCard() {
  const card = sectionCard('Paragon & Other Multipliers',
    'Paragon legendary / rare nodes, key passives, class mechanics, auras, sacrifices, and any other long-tail damage sources that aren\u2019t already covered by gear aspects, glyphs, charms, or your stats sheet. Add one row per source.');

  const hint = CLASS_HINTS[build.classId];
  if (hint) {
    card.append(el('p', { class: 'text-xs text-zinc-500 mb-3' },
      el('span', { class: 'text-zinc-400' }, `Common sources for ${build.classId}:`),
      ' ', hint));
  }
  const slot = build.slots.find(s => s.id === 'paragon');
  if (slot) card.append(slotBlock(slot));

  // Running total of Custom [x]% multipliers entered IN THIS SLOT. (The Stats Summary card shows
  // the build-wide combined factor; this one is scoped to paragon/other so users see the local effect.)
  if (slot) {
    const factors = slot.affixes.filter(a => a.bucket === 'EXTRAMULT' && a.value !== 0);
    if (factors.length > 0) {
      const combined = factors.reduce((p, a) => p * (1 + a.value), 1);
      card.append(el('div', { class: 'mt-2 flex items-center justify-between text-xs px-3 py-2 rounded bg-zinc-800/60 border border-zinc-700' },
        el('span', { class: 'text-zinc-400' }, `Paragon / other combined [x]% factor (${factors.length} source${factors.length === 1 ? '' : 's'})`),
        el('span', { class: 'text-zinc-200 font-mono font-bold tabular-nums' }, `\u00d7${combined.toFixed(2)}`),
      ));
    }
  }
  return card;
}

function slotBlock(slot: Slot) {
  const isWeapon = slot.id.startsWith('wep');
  const isParagon = slot.id === 'paragon';
  const isEmpty = slot.affixes.length === 0 && (!isWeapon || (slot.weaponTypeId ?? 'none') === 'none');

  // Slots eligible for a pinned legendary aspect row (essentially all armor / jewelry / weapons).
  // We expand these even when empty so the user always sees the aspect placeholder + gem rows.
  // Charms / seal / glyphs / set bonus do NOT carry aspects, so they keep the collapsed-when-empty behavior.
  const GEAR_SLOTS = new Set(['helm','chest','pants','boots','gloves','amulet','ring1','ring2','wep1','wep2','wep3','wep4']);
  const isGearSlot = GEAR_SLOTS.has(slot.id);
  if (isEmpty && !isWeapon && !isParagon && !isGearSlot) {
    const row = el('div', { class: 'flex items-center justify-between gap-3 py-1.5 px-3 mb-1 border border-zinc-800/60 rounded text-sm hover:border-zinc-700 transition-colors' });
    row.append(el('span', { class: 'text-zinc-500' }, slot.name));
    const addBtn = el('button', { class: 'text-xs text-amber-400 hover:text-amber-300 px-2 py-0.5 rounded border border-amber-700/50' }, '+ Add Affix');
    addBtn.addEventListener('click', () => { slot.affixes.push({ bucket: 'CSDM', value: 0 }); mount(); });
    row.append(addBtn);
    return row;
  }

  const wrap = el('div', { class: 'border border-zinc-800 rounded-lg p-3 mb-2' });

  const header = el('div', { class: 'flex items-center gap-3 mb-2 flex-wrap' });
  if (!isParagon) header.append(el('h3', { class: 'font-semibold text-zinc-200 mr-auto' }, slot.name));
  else header.append(el('span', { class: 'mr-auto' }));

  if (isWeapon) {
    const sel = el('select', { class: inputCls() + ' text-xs', title: FIELD_HELP['slot_weaponType'] }) as HTMLSelectElement;
    for (const wt of WEAPON_TYPES) {
      if (wt.allowedClasses && !wt.allowedClasses.includes(build.classId)) continue;
      const opt = el('option', { value: wt.id }, wt.label);
      if (wt.id === (slot.weaponTypeId ?? 'none')) opt.setAttribute('selected', '');
      sel.append(opt);
    }
    sel.addEventListener('change', () => { slot.weaponTypeId = sel.value; mount(); });
    header.append(sel);
    const wt = weaponTypeById(slot.weaponTypeId ?? 'none');
    if (wt.baseDamage > 0) {
      const overrides = slot.affixes.filter(a => a.bucket === 'WEPDMG').reduce((s, a) => s + a.value, 0);
      const total = wt.baseDamage + overrides;
      const dmgChip = el('span', {
        class: 'text-xs text-zinc-400 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 whitespace-nowrap',
        title: overrides !== 0
          ? `Base ${wt.baseDamage.toLocaleString()} + ${overrides >= 0 ? '+' : ''}${overrides.toLocaleString()} from + Weapon Damage affix(es) below`
          : `Built-in baseline for ${wt.label}. Add a “+ Weapon Damage” affix below to override.`,
      }, `${total.toLocaleString()} dmg`);
      header.append(dmgChip);
    }
  }

  const addBtn = el('button', { class: 'text-xs text-amber-400 hover:text-amber-300 px-2 py-1 rounded border border-amber-700/50' }, '+ Add Affix');
  addBtn.addEventListener('click', () => { slot.affixes.push({ bucket: 'CSDM', value: 0 }); mount(); });
  header.append(addBtn);
  wrap.append(header);

  // Shield-specific note: every D4 shield has an innate +100% Weapon Damage Bonus, and the calc
  // auto-applies it. Surface a small info note so users know it's already counted (and don't
  // re-add it manually).
  if (isWeapon && slot.weaponTypeId === 'shield') {
    wrap.append(el('div', { class: 'mb-2 px-2 py-1.5 text-[11px] rounded border border-emerald-500/30 bg-emerald-500/5 text-emerald-200/90' },
      '✓ Shield innate ',
      el('span', { class: 'font-semibold' }, '+100% Weapon Damage Bonus'),
      ' is auto-applied. Do not add it again. Aspect bonuses on top of it (rare) can still be added as a “+% Weapon Damage Bonus” affix.',
    ));
  }

  // Armor gems live on helm, chest, pants; weapon gems live on weapon slots.
  // The actual affix list hides any gem entries (matched by known label) so they only appear
  // in the dedicated Gem rows below. 2H weapons get 2 sockets, everything else gets 1.
  const ARMOR_GEM_SLOTS = new Set(['helm', 'chest', 'pants']);
  const ARMOR_GEM_LABELS = ['Armor gem 1', 'Armor gem 2'];
  const WEAPON_GEM_LABELS = ['Weapon gem 1', 'Weapon gem 2'];
  const isArmorGemSlot = ARMOR_GEM_SLOTS.has(slot.id);
  const isWeaponGemSlot = slot.id.startsWith('wep');
  const weaponSockets = isWeaponGemSlot
    ? (weaponTypeById(slot.weaponTypeId ?? 'none').hands === 2 ? 2 : 1)
    : 0;
  const gemLabels = isArmorGemSlot
    ? ARMOR_GEM_LABELS
    : isWeaponGemSlot ? WEAPON_GEM_LABELS.slice(0, weaponSockets)
    : [];

  // (Removed weaponAvgDamage input. The hardcoded baseline + WEPDMG affix already matches the in-game tooltip.)

  // Hide gem affixes from the normal affix list since they get dedicated checkbox rows below.
  // Armor gems are MAINSTAT-bucket; weapon gems are GEM-bucket. Both match by known label.
  const isHiddenGemAffix = (a: { bucket: Bucket; label?: string }) => {
    if (!a.label) return false;
    if (isArmorGemSlot && a.bucket === 'MAINSTAT' && ARMOR_GEM_LABELS.includes(a.label)) return true;
    if (isWeaponGemSlot && a.bucket === 'GEM' && WEAPON_GEM_LABELS.includes(a.label)) return true;
    return false;
  };
  // Old share-links may carry unlabeled GEM-bucket affixes from the legacy dropdown. The GEM
  // bucket has been removed from the dropdown in favor of dedicated weapon-gem checkbox rows,
  // so showing those stale rows would expose a bucket type the user can no longer re-add. Hide
  // them in weapon slots; calc still sums them so damage numbers don't change silently.
  const isLegacyWeaponGem = (a: { bucket: Bucket; label?: string }) =>
    isWeaponGemSlot && a.bucket === 'GEM' && !WEAPON_GEM_LABELS.includes(a.label ?? '');
  // Hide the pinned legendary aspect (matched by label prefix, any bucket) so it doesn't double-render in the affix list.
  const ASPECT_LABEL_KEY = 'Legendary Aspect';
  const isPinnedAspect = (a: { bucket: Bucket; label?: string }) =>
    !!a.label && (a.label === ASPECT_LABEL_KEY || a.label.startsWith(ASPECT_LABEL_KEY + ':'));
  const visibleAffixes = slot.affixes.map((a, i) => ({ a, i })).filter(({ a }) => !isHiddenGemAffix(a) && !isLegacyWeaponGem(a) && !isPinnedAspect(a));

  if (visibleAffixes.length === 0) wrap.append(el('p', { class: 'text-xs text-zinc-600 italic' }, 'No affixes.'));

  visibleAffixes.forEach(({ a, i: idx }) => {
    const row = el('div', { class: 'flex flex-wrap sm:flex-nowrap gap-2 mb-1.5 items-center min-w-0' });
    const sel = el('select', { class: inputCls() + ' w-full sm:flex-1 min-w-0', title: FIELD_HELP['affix_bucket'] }) as HTMLSelectElement;
    const candidates = BUCKET_ORDER.filter(b => {
      // Weapon damage stays weapon-only; weapon gems get their own dedicated row UI below so we
      // never expose GEM in the dropdown to keep affixes/gems from drifting out of sync.
      if (b === 'GEM') return false;
      if (b === 'WEPDMG' && !isWeapon) return false;
      return true;
    });
    const customBuckets = new Set(['ADDITIVE', 'EXTRAMULT']);
    candidates.sort((x, y) => {
      const xc = customBuckets.has(x), yc = customBuckets.has(y);
      if (xc !== yc) return xc ? 1 : -1;
      return BUCKET_META[x].label.localeCompare(BUCKET_META[y].label);
    });
    for (const b of candidates) {
      const opt = el('option', { value: b }, BUCKET_META[b].label);
      if (b === a.bucket) opt.setAttribute('selected', '');
      sel.append(opt);
    }
    sel.addEventListener('change', () => { a.bucket = sel.value as Bucket; mount(); });
    row.append(sel);

    // Optional inline label, shown for buckets where it helps document what the entry is.
    // Sits between the bucket dropdown and the value so it shares the row instead of wrapping below.
    const labelable = a.bucket === 'EXTRAMULT' || a.bucket === 'ADDITIVE' || a.bucket === 'MAINSTAT_PCT' || a.bucket === 'GEM';
    if (labelable) {
      row.append(textInput(() => a.label ?? '', v => { a.label = v; }, { w: 'w-full sm:flex-1 min-w-0', placeholder: 'Optional label (e.g. “Heir of Perdition”)' }));
    }

    // Number input + unit suffix as a fixed-width pair so percent and non-percent rows align.
    const isPct = BUCKET_META[a.bucket].isPercent;
    const valWrap = el('div', { class: 'flex items-center gap-1 shrink-0' });
    if (isPct) {
      valWrap.append(pctInput(() => a.value, v => a.value = v, { w: 'w-20 text-right' }));
    } else {
      valWrap.append(numInput(() => a.value, v => a.value = v, { w: 'w-20 text-right' }));
    }
    // Always render a fixed-width unit slot so the X button lines up across rows.
    valWrap.append(el('span', { class: 'text-zinc-600 text-xs w-3 inline-block' }, isPct ? '%' : ''));
    row.append(valWrap);

    const del = el('button', { class: 'text-zinc-500 hover:text-red-400 px-2 shrink-0' }, '✕');
    del.addEventListener('click', () => { slot.affixes.splice(idx, 1); mount(); });
    row.append(del);
    wrap.append(row);
  });

  // Pinned legendary aspect row on gear slots. Most build damage comes from stacked aspects/uniques,
  // and forgetting to enter them is the #1 reason calculated damage is way lower than in-game.
  // Same UX as gem rows: checkbox to enable, x% input, label input. Stored as a slot-local
  // EXTRAMULT affix with the well-known label "Legendary Aspect" so we can find / round-trip it.
  if (isGearSlot) {
    // Aspect-by-label lookup (any bucket). Behaves like a regular affix slot but pinned, with a bucket dropdown.
    // Most aspects are EXTRAMULT (Custom [x]%), but some apply to MAINSTAT_PCT, CSDM, ADDITIVE, etc. —
    // matching the in-game variety where Eagle's Eye adds to crit damage multiplier, Herald of Zakarum's unique
    // adds +% main stat, etc.
    const ASPECT_LABEL_KEY = 'Legendary Aspect';
    const findAspect = () => slot.affixes.find(a => !!a.label && (a.label === ASPECT_LABEL_KEY || a.label.startsWith(ASPECT_LABEL_KEY + ':')));
    const existingAspect = findAspect();
    let lastValue = existingAspect?.value ?? 0;
    let lastBucket: Bucket = existingAspect?.bucket ?? 'EXTRAMULT';

    const aspectRow = el('div', { class: 'flex items-center gap-2 mb-1 mt-1 pt-1 border-t border-zinc-800/60 text-sm flex-wrap sm:flex-nowrap' });
    const cb = el('input', { type: 'checkbox', class: 'accent-amber-500 shrink-0' }) as HTMLInputElement;
    cb.checked = !!existingAspect;
    aspectRow.append(cb);
    aspectRow.append(el('span', { class: 'text-zinc-400 w-16 shrink-0', title: 'Legendary aspect (or unique effect) on this item. Pick the bucket the aspect contributes to (most are Custom [x]%; some add to crit damage / main stat / etc.).' }, 'Aspect'));

    // Bucket dropdown — same options as a regular affix row, same sort.
    const bucketSel = el('select', { class: inputCls() + ' text-xs w-auto sm:w-auto min-w-0 max-w-[12rem]' }) as HTMLSelectElement;
    const aspectCandidates = BUCKET_ORDER.filter(b => {
      if (b === 'GEM') return false;
      if (b === 'WEPDMG' && !isWeapon) return false;
      return true;
    });
    const customBuckets = new Set<Bucket>(['ADDITIVE', 'EXTRAMULT']);
    aspectCandidates.sort((x, y) => {
      const xc = customBuckets.has(x), yc = customBuckets.has(y);
      if (xc !== yc) return xc ? -1 : 1; // custom buckets FIRST in aspect dropdown since they're the common case
      return BUCKET_META[x].label.localeCompare(BUCKET_META[y].label);
    });
    for (const b of aspectCandidates) {
      const opt = el('option', { value: b }, BUCKET_META[b].label);
      if (b === lastBucket) opt.setAttribute('selected', '');
      bucketSel.append(opt);
    }
    aspectRow.append(bucketSel);

    // Value input (% for percent buckets, raw number otherwise) + unit suffix.
    // We rebuild this input when the bucket changes so isPercent stays consistent.
    const valWrap = el('div', { class: 'flex items-center gap-1 shrink-0' });
    let valInput: HTMLInputElement;
    let unitSpan: HTMLSpanElement;
    const buildValInput = () => {
      valWrap.innerHTML = '';
      const isPct = BUCKET_META[lastBucket].isPercent;
      valInput = (isPct
        ? pctInput(() => findAspect()?.value ?? lastValue, v => { lastValue = v; const a = findAspect(); if (a) a.value = v; }, { w: 'w-20 text-right' })
        : numInput(() => findAspect()?.value ?? lastValue, v => { lastValue = v; const a = findAspect(); if (a) a.value = v; }, { w: 'w-20 text-right' })) as HTMLInputElement;
      valWrap.append(valInput);
      unitSpan = el('span', { class: 'text-zinc-600 text-xs w-3 inline-block' }, isPct ? '%' : '') as HTMLSpanElement;
      valWrap.append(unitSpan);
      applyAspectDisabled();
    };

    // Optional descriptor (free text). Stored in the label as `Legendary Aspect: <desc>`.
    const desc = el('input', { type: 'text', placeholder: 'e.g. of Berserk Ripping, Edgemaster\u2019s', class: inputCls() + ' flex-1 min-w-0 text-xs' }) as HTMLInputElement;
    desc.value = existingAspect && existingAspect.label && existingAspect.label.startsWith(ASPECT_LABEL_KEY + ':')
      ? existingAspect.label.slice(ASPECT_LABEL_KEY.length + 1).trim()
      : '';
    desc.addEventListener('input', () => {
      const a = findAspect();
      if (a) {
        a.label = desc.value.trim() ? `${ASPECT_LABEL_KEY}: ${desc.value.trim()}` : ASPECT_LABEL_KEY;
        afterInput();
      }
    });

    const applyAspectDisabled = () => {
      const dim = !cb.checked;
      bucketSel.disabled = dim;
      desc.disabled = dim;
      if (valInput) valInput.disabled = dim;
      bucketSel.classList.toggle('opacity-40', dim);
      desc.classList.toggle('opacity-40', dim);
      if (valInput) valInput.classList.toggle('opacity-40', dim);
      if (unitSpan) unitSpan.classList.toggle('opacity-40', dim);
    };

    buildValInput();
    aspectRow.append(valWrap);
    aspectRow.append(desc);
    applyAspectDisabled();

    bucketSel.addEventListener('change', () => {
      const prevBucket = lastBucket;
      lastBucket = bucketSel.value as Bucket;
      const a = findAspect();
      // Resetting value when crossing the percent/raw boundary avoids silently turning e.g.
      // a +200 MAINSTAT aspect into a +20000% EXTRAMULT (or a 0.5 EXTRAMULT into +0.5 WEPDMG).
      if (BUCKET_META[prevBucket].isPercent !== BUCKET_META[lastBucket].isPercent) {
        lastValue = 0;
        if (a) a.value = 0;
      }
      if (a) a.bucket = lastBucket;
      buildValInput();
      afterInput();
    });

    cb.addEventListener('change', () => {
      const existing = findAspect();
      if (cb.checked && !existing) {
        const label = desc.value.trim() ? `${ASPECT_LABEL_KEY}: ${desc.value.trim()}` : ASPECT_LABEL_KEY;
        slot.affixes.push({ bucket: lastBucket, value: lastValue, label });
      } else if (!cb.checked && existing) {
        lastValue = existing.value;
        lastBucket = existing.bucket;
        slot.affixes.splice(slot.affixes.indexOf(existing), 1);
      }
      applyAspectDisabled();
      if (valInput) valInput.value = BUCKET_META[lastBucket].isPercent ? String((findAspect()?.value ?? lastValue) * 100) : String(findAspect()?.value ?? lastValue);
      afterInput();
    });

    wrap.append(aspectRow);
  }

  // Gem sockets: armor (helm/chest/pants) sockets a +MAINSTAT gem; weapons socket Royal gems
  // (1 for 1H/shield, 2 for 2H) which land in the GEM bucket (sums into All / Element).
  // Rendering mirrors the in-game item tooltip: a single row per gem, no section header,
  // "Gem" label on the left, inline value + descriptor on the right.
  if (gemLabels.length > 0) {
    const cls = classFor(build);
    const isArmor = isArmorGemSlot;
    const defaultValue = isArmor ? 90 : 0.24;
    gemLabels.forEach((gemLabel) => {
      const bucket: Bucket = isArmor ? 'MAINSTAT' : 'GEM';
      const findGem = () => slot.affixes.find(x => x.bucket === bucket && x.label === gemLabel);
      // Remember the last user-entered value so unchecking + re-checking the gem doesn't reset
      // it back to defaultValue. Seeded from any existing affix value when the row first renders.
      let lastValue = findGem()?.value ?? defaultValue;
      const gemRow = el('div', { class: 'flex items-center gap-2 mb-1 text-sm' });
      const cb = el('input', { type: 'checkbox', class: 'accent-amber-500' }) as HTMLInputElement;
      cb.checked = !!findGem();
      gemRow.append(cb);
      gemRow.append(el('span', { class: 'text-zinc-400 w-12' }, 'Gem'));

      // Inline number + descriptor. Match the in-game tooltip format:
      //   armor:  "+90 Strength"
      //   weapon: "x24% Element Damage Multiplier"
      const prefix = el('span', { class: 'text-zinc-500 text-sm' }, isArmor ? '+' : 'x');
      const input = (isArmor
        ? numInput(
            () => findGem()?.value ?? lastValue,
            v => { lastValue = v; const g = findGem(); if (g) g.value = v; },
            { w: 'w-16 text-right' })
        : pctInput(
            () => findGem()?.value ?? lastValue,
            v => { lastValue = v; const g = findGem(); if (g) g.value = v; },
            { w: 'w-16 text-right' })) as HTMLInputElement;
      const suffix = el('span', { class: 'text-zinc-400 text-sm' }, isArmor
        ? cls.mainStat
        : '% Element Damage Multiplier');
      gemRow.append(prefix, input, suffix);

      const applyDisabled = () => {
        input.disabled = !cb.checked;
        const dim = !cb.checked;
        input.classList.toggle('opacity-40', dim);
        prefix.classList.toggle('opacity-40', dim);
        suffix.classList.toggle('opacity-40', dim);
      };
      applyDisabled();

      cb.addEventListener('change', () => {
        const existing = findGem();
        if (cb.checked && !existing) {
          // Restore the user's last entered value rather than always resetting to defaultValue.
          slot.affixes.push({ bucket, value: lastValue, label: gemLabel });
        } else if (!cb.checked && existing) {
          // Cache the current value before removing so re-checking restores it.
          lastValue = existing.value;
          slot.affixes.splice(slot.affixes.indexOf(existing), 1);
        }
        applyDisabled();
        input.value = isArmor
          ? String(findGem()?.value ?? lastValue)
          : String((findGem()?.value ?? lastValue) * 100);
        afterInput();
      });

      wrap.append(gemRow);
    });
  }


  return wrap;
}

// ---------- OUTPUT: Scenarios ----------
// Transient UI state for the scenarios card (not persisted).
// Vulnerable / Elite default ON since those are the most common targeting assumptions.
const scenarioState = { vulnerable: true, elites: true, close: false, distant: false, cc: false };

function scenariosCard() {
  // Build the DoT mode switch upfront so we can mount it in the card header.
  // Switch (track + thumb) rather than another pill: it communicates a binary mode toggle better
  // than the chips do, and clearly distinguishes itself from the per-target chips below.
  const dotOn = build.disableCrit;
  const dotSwitch = el('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': dotOn ? 'true' : 'false',
    title: FIELD_HELP['scenario_dot'],
    class: 'group inline-flex items-center gap-2 select-none cursor-pointer text-xs font-medium ' +
      (dotOn ? 'text-emerald-300' : 'text-zinc-400 hover:text-zinc-200'),
  },
    el('span', { class: 'normal-case tracking-normal' }, 'DoT skill'),
    el('span', { class: 'relative inline-block w-9 h-5 rounded-full transition ' +
      (dotOn ? 'bg-emerald-500/70' : 'bg-zinc-700 group-hover:bg-zinc-600') },
      el('span', { class: 'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-zinc-100 shadow transition-transform ' + (dotOn ? 'translate-x-4' : 'translate-x-0') }),
    ),
  );
  dotSwitch.addEventListener('click', () => { build.disableCrit = !build.disableCrit; persist(build); mount(); });

  const card = sectionCard('Damage', undefined, dotSwitch);
  const c = calc(build);
  if (c.weaponDmg === 0) {
    card.append(el('p', { class: 'text-xs text-amber-400' }, '⚠️ Pick a weapon type in your weapon slot to enable damage output.'));
    return card;
  }

  // Compute scenarios. In DoT-build mode we don't show crit/avg; the primary readout IS the DoT tick.
  const conds = { ...scenarioState };
  const scenarioHit: any = { id: 'hit', label: 'hit', conditions: conds };
  const scenarioDot: any = { id: 'dot', label: 'dot', conditions: conds, isDot: true };
  const isDotMode = build.disableCrit;
  const hitDmg = scenarioDamageNoCrit(build, scenarioHit);
  const critDmg = isDotMode ? 0 : scenarioCritOnly(build, scenarioHit);
  const dotDmg = scenarioDamage(build, scenarioDot);
  // Show DoT tick alongside crit when the DoT bucket has any contribution OR there's a DoT-only additive line entered.
  const dotLinesSum = build.additiveLines.filter(l => (l as any).isDotOnly).reduce((s, l) => s + l.value, 0);
  const showDotReadout = !isDotMode && (c.dotm > 1 || dotLinesSum > 0);

  // ----- Readouts come first so the answer is the first thing the eye lands on. -----
  // Each cell sits in its own subtle card; Hit / Crit / DoT colors match in-game text colors.
  const readoutCellCls = 'rounded-lg bg-zinc-950/40 border border-zinc-800/80 px-3 py-3 text-center';
  const labelCls = 'text-[10px] uppercase tracking-wider text-zinc-500 mb-1';
  const cell = (label: string, value: string, valueCls: string, title?: string) => {
    const attrs: any = { class: readoutCellCls };
    if (title) attrs.title = title;
    return el('div', attrs,
      el('div', { class: labelCls }, label),
      el('div', { class: 'text-2xl sm:text-3xl font-bold font-mono leading-tight ' + valueCls }, value),
    );
  };
  let row: HTMLElement;
  if (isDotMode) {
    row = el('div', { class: 'grid grid-cols-1 gap-2 mb-2' });
    row.append(cell('DoT tick', fmtBigNum(dotDmg), 'text-emerald-400',
      'DoT tick: non-crit hit × Damage Over Time Multiplier, with DoT-only additive lines applied. Vulnerable / conditional toggles still apply.'));
  } else {
    row = el('div', { class: showDotReadout ? 'grid grid-cols-3 gap-2 mb-2' : 'grid grid-cols-2 gap-2 mb-2' });
    row.append(cell('Hit',  fmtBigNum(hitDmg),  'text-zinc-100'));
    row.append(cell('Crit', fmtBigNum(critDmg), 'text-amber-400'));
    if (showDotReadout) {
      row.append(cell('DoT tick', fmtBigNum(dotDmg), 'text-emerald-400',
        'DoT tick: non-crit hit × Damage Over Time Multiplier, with DoT-only additive lines applied.'));
    }
  }
  card.append(row);

  // Average line: clean centered row under Hit/Crit. No frame; the cells above already provide structure.
  // We render the avg number itself in zinc-100 (matches Hit) so it doesn't compete with the bold amber Crit value;
  // crit-chance label sits inline as dim caption text.
  if (!isDotMode) {
    const avg = critDmg * c.critChance + hitDmg * (1 - c.critChance);
    card.append(el('div', { class: 'mt-2 mb-1 flex items-baseline justify-center gap-2' },
      el('span', { class: 'text-[11px] text-zinc-500' }, `Average @ ${(c.critChance*100).toFixed(1)}% crit`),
      el('span', { class: 'text-lg font-bold font-mono text-zinc-100 tabular-nums' }, fmtBigNum(avg)),
    ));
  }

  // ----- Target chips under the readouts. The DoT mode switch lives in the card header above. -----
  const togglesRow = el('div', { class: 'pt-3 mt-2 border-t border-zinc-800/80 flex flex-wrap gap-1.5' });
  const toggles: { key: keyof typeof scenarioState; label: string; help: string }[] = [
    { key: 'vulnerable', label: 'Vulnerable', help: FIELD_HELP['scenario_vulnerable'] },
    { key: 'elites',     label: 'Elite',      help: FIELD_HELP['scenario_elites'] },
    { key: 'close',      label: 'Close',      help: FIELD_HELP['scenario_close'] },
    { key: 'distant',    label: 'Distant',    help: FIELD_HELP['scenario_distant'] },
    { key: 'cc',         label: 'CC',         help: FIELD_HELP['scenario_cc'] },
  ];
  for (const t of toggles) {
    const active = !!scenarioState[t.key];
    const chip = el('button', {
      type: 'button',
      title: t.help,
      'aria-pressed': active ? 'true' : 'false',
      class: 'px-2.5 py-1 rounded-full text-xs font-medium transition border ' +
        (active
          ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 hover:bg-amber-500/30'
          : 'bg-zinc-800/60 text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-200'),
    }, t.label);
    chip.addEventListener('click', () => { scenarioState[t.key] = !scenarioState[t.key]; refreshOutputs(); });
    togglesRow.append(chip);
  }
  card.append(togglesRow);

  // Snapshot delta. Compare on the same basis as the primary readout (DoT tick vs hit) so the % delta is meaningful.
  if (build.snapshot) {
    const snapBuild = { ...build.snapshot, snapshot: null } as Build;
    const refNow = isDotMode ? dotDmg : hitDmg;
    const refSnap = isDotMode ? scenarioDamage(snapBuild, scenarioDot) : scenarioDamageNoCrit(snapBuild, scenarioHit);
    if (refSnap > 0) {
      const delta = refNow / refSnap - 1;
      const sign = delta >= 0 ? '+' : '';
      const cls = delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-zinc-500';
      const deltaRow = el('div', { class: 'mt-2 pt-2 border-t border-zinc-800 flex items-center justify-between text-xs gap-2' });
      deltaRow.append(el('span', { class: 'text-zinc-500' }, '📌 vs saved build:'));
      deltaRow.append(el('span', { class: cls + ' font-bold tabular-nums' }, sign + fmtPct(delta, 2)));
      card.append(deltaRow);
    }
  }
  return card;
}

// Helper: compute a forced-crit hit
function scenarioCritOnly(b: Build, scenario: any): number {
  // Pretend crit chance is 1 for a clean crit readout
  const allCrit = { ...b, baseCritChance: 1, slots: b.slots.map(s => ({ ...s, affixes: s.affixes.filter(a => a.bucket !== 'CRITCHANCE') })) } as Build;
  return scenarioDamage(allCrit, scenario);
}

// ---------- OUTPUT: Buckets ----------
function bucketsCard() {
  const card = sectionCard('Upgrade Priority');

  const c = calc(build);
  if (c.weaponDmg === 0) {
    card.append(el('p', { class: 'text-xs text-amber-400' }, '⚠️ Pick a weapon type to compute weights.'));
    return card;
  }

  const isDotMode = build.disableCrit;
  // In DoT mode, weights are evaluated against a DoT tick (crit/CSDM are dead, DOTM matters).
  const refScenario = isDotMode
    ? { id: 'live', label: 'current DoT scenario', conditions: { ...scenarioState }, isDot: true } as any
    : { id: 'live', label: 'current scenario', conditions: { ...scenarioState } } as any;

  const cls = classFor(build);
  type Row = { affix: string; gain: number; warn?: string };
  const rows: Row[] = [];
  if (isDotMode) {
    // DoT-focused affix list: drop crit-related rows, surface DOTM.
    rows.push({ affix: 'x10% Damage Over Time Multiplier',  gain: weightFor(build, 'DOTM', 0.10, refScenario) });
    rows.push({ affix: 'x10% Vulnerable Damage Multiplier', gain: weightFor(build, 'VDM', 0.10, refScenario) });
    rows.push({ affix: 'x10% All / Element Damage Multiplier', gain: weightFor(build, 'ALLM', 0.10, refScenario) });
    rows.push({ affix: '+10% Damage (additive)',            gain: weightFor(build, 'ADDITIVE', 0.10, refScenario) });
    rows.push({ affix: `+100 ${cls.mainStat}`,              gain: weightFor(build, 'MAINSTAT', 100, refScenario) });
    rows.push({ affix: `+10% ${cls.mainStat}`,              gain: weightFor(build, 'MAINSTAT_PCT', 0.10, refScenario) });
    rows.push({ affix: '+100 Weapon Damage',                gain: weightFor(build, 'WEPDMG', 100, refScenario) });
    rows.push({ affix: '+3 Skill Ranks',                    gain: weightFor(build, 'SKILLRANK', 3, refScenario) });
  } else {
    rows.push({ affix: 'x10% Critical Strike Damage Multiplier', gain: weightFor(build, 'CSDM', 0.10, refScenario) });
    rows.push({ affix: 'x10% Vulnerable Damage Multiplier',      gain: weightFor(build, 'VDM', 0.10, refScenario) });
    rows.push({ affix: 'x10% All / Element Damage Multiplier',   gain: weightFor(build, 'ALLM', 0.10, refScenario) });
    rows.push({ affix: '+10% Critical Strike Damage',            gain: weightFor(build, 'CRITADD', 0.10, refScenario) });
    rows.push({ affix: '+10% Damage (additive)',                 gain: weightFor(build, 'ADDITIVE', 0.10, refScenario) });
    rows.push({ affix: `+100 ${cls.mainStat}`,                   gain: weightFor(build, 'MAINSTAT', 100, refScenario) });
    rows.push({ affix: `+10% ${cls.mainStat}`,                   gain: weightFor(build, 'MAINSTAT_PCT', 0.10, refScenario) });
    rows.push({ affix: '+5% Critical Strike Chance',             gain: weightFor(build, 'CRITCHANCE', 0.05, refScenario), warn: c.critChance >= 1 ? 'capped' : undefined });
    rows.push({ affix: '+100 Weapon Damage',                     gain: weightFor(build, 'WEPDMG', 100, refScenario) });
    rows.push({ affix: '+3 Skill Ranks',                         gain: weightFor(build, 'SKILLRANK', 3, refScenario) });
  }
  rows.sort((a, b) => b.gain - a.gain);

  const table = el('table', { class: 'w-full text-sm' });
  table.append(el('thead', {},
    el('tr', { class: 'text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-800' },
      el('th', { class: 'text-left py-1 font-normal' }, 'Affix'),
      el('th', { class: 'text-right py-1 font-normal whitespace-nowrap pl-2' }, 'Damage Gain'),
    ),
  ));
  const tb = el('tbody');
  for (const r of rows) {
    const isHot = r.gain > 0.05, isCold = r.gain < 0.005;
    const gainCls = isHot ? 'text-emerald-400 font-semibold' : isCold ? 'text-zinc-600' : 'text-amber-400';
    const left = el('td', { class: 'py-1 min-w-0 text-zinc-200' }, r.affix);
    if (r.warn) left.append(el('span', { class: 'ml-2 text-xs text-red-400' }, '⚠️ ' + r.warn));
    tb.append(el('tr', { class: 'border-b border-zinc-900' },
      left,
      el('td', { class: 'py-1 text-right tabular-nums pl-2 whitespace-nowrap ' + gainCls }, fmtPct(r.gain)),
    ));
  }
  table.append(tb);
  card.append(table);

  // "How buckets work" at the bottom, expanded by default.
  // "Why some affixes are worth more than others" at the bottom. Collapsed by default now
  // that the table itself is the primary content.
  card.append(el('details', { class: 'mt-4 text-xs text-zinc-500' },
    el('summary', { class: 'cursor-pointer text-zinc-400 select-none' }, 'Why some affixes are worth more than others'),
    el('div', { class: 'mt-2 text-zinc-400 space-y-2' },
      el('p', {}, 'Same-named affixes ', el('strong', {}, 'sum into one bucket'), '; the bucket then multiplies into the damage formula. A small bucket gains more from a new affix than a big one.'),
      el('p', {}, 'Example: CSDM bucket at +150% (×2.50). Adding x10% → +160% (×2.60). Damage gain = 2.60 / 2.50 = +4%. If your Vulnerable bucket only had +20% (×1.20), same +10% affix goes to ×1.30 → +8.3%, twice as good.'),
      el('p', {}, el('strong', {}, '+ vs x: '), '“+75% Crit Damage” joins the giant additive bucket. “x56% Crit Damage Multiplier” is its own much smaller bucket. The x version is usually 3-5× more valuable in late game.'),
    ),
  ));

  return card;
}

// ---------- OUTPUT: Damage Multiplier Breakdown ----------
// Visualize the per-bucket multipliers compounding into the final damage number,
// using the same scenario the Damage card is showing (target chip state + DoT toggle).
// Bars are log-scaled so a 30x bucket doesn't crush every other bar to invisibility.
function breakdownCard() {
  const card = sectionCard('Damage Multiplier Breakdown', 'Each bucket as its own factor. Bars are log-scaled (a 10x factor is twice as wide as a ~3.16x). Smallest bars are usually your best upgrade opportunities.');

  const c = calc(build);
  if (c.weaponDmg === 0) {
    card.append(el('p', { class: 'text-xs text-amber-400' }, '⚠️ Pick a weapon type to compute the breakdown.'));
    return card;
  }

  const isDotMode = build.disableCrit;
  const conds: any = { ...scenarioState, isDot: isDotMode };
  const baseAdd = additiveForScenario(build, conds);
  const critExtra = critOnlyAdditive(build);

  // Effective crit factor in the average-hit sense: 1 + p_crit * (1.5 * csdm * (1+baseAdd+critExtra)/(1+baseAdd) - 1).
  // For display we expose it as the *expected* uplift from crits on top of the non-crit hit; equals 1 in DoT mode.
  let critFactor = 1;
  if (!isDotMode && c.critChance > 0) {
    const nonCritMultiplier = (1 + baseAdd);
    const critMultiplier = (1 + baseAdd + critExtra) * 1.5 * c.csdm;
    if (nonCritMultiplier > 0) {
      critFactor = c.critChance * (critMultiplier / nonCritMultiplier) + (1 - c.critChance);
    }
  }

  // Build the ordered list of factors. Skip 1x factors so the list stays meaningful (no
  // "Non-Physical: 1.00x" noise rows).
  type Row = { label: string; mult: number; color: string };
  const rows: Row[] = [];
  const push = (label: string, mult: number, color: string) => {
    if (!isFinite(mult) || mult <= 0) return;
    if (Math.abs(mult - 1) < 1e-6) return;
    rows.push({ label, mult, color });
  };

  push('Skill base damage', c.skillCoef, 'bg-amber-600');
  push('Main stat (×1 + S/divisor)', c.mainStatMult, 'bg-emerald-600');
  push('Additive bucket (+% damage)', 1 + baseAdd, 'bg-cyan-600');
  push('All / Element / Non-Phys', c.allm, 'bg-indigo-600');
  if (scenarioState.vulnerable) push('Vulnerable (1.2 × VDM)', c.vdm * 1.2, 'bg-yellow-600');
  if (!isDotMode) push('Crit (expected uplift)', critFactor, 'bg-rose-600');
  if (isDotMode || c.dotm > 1) push('Damage Over Time', c.dotm, 'bg-emerald-500');
  push('Custom [x]% (aspects / paragon / set)', c.extraMultProduct, 'bg-fuchsia-600');
  push('Enemy damage factor', build.enemyDamageFactor, 'bg-zinc-500');

  if (rows.length === 0) {
    card.append(el('p', { class: 'text-xs text-zinc-500' }, 'No multipliers above 1x yet. Add some affixes and they’ll show up here.'));
    return card;
  }

  // Log-scale the bar widths against the largest factor so bars are comparable.
  const maxLog = Math.max(...rows.map(r => Math.log(Math.max(r.mult, 1)))) || 1;

  const barsWrap = el('div', { class: 'space-y-1.5' });
  for (const r of rows) {
    const widthPct = Math.max(2, Math.min(100, (Math.log(Math.max(r.mult, 1)) / maxLog) * 100));
    const lineBelow1 = r.mult < 1; // e.g. enemyDamageFactor
    const barColor = lineBelow1 ? 'bg-zinc-500/60' : r.color;
    const row = el('div', { class: 'text-[11px]' },
      el('div', { class: 'flex items-baseline justify-between gap-2 mb-0.5' },
        el('span', { class: 'text-zinc-400 truncate' }, r.label),
        el('span', { class: 'text-zinc-200 font-mono tabular-nums shrink-0' }, `×${r.mult.toFixed(2)}`),
      ),
      el('div', { class: 'h-2 bg-zinc-900 rounded overflow-hidden' },
        Object.assign(el('div', { class: `h-full ${barColor}` }), { style: `width: ${widthPct.toFixed(1)}%` } as any),
      ),
    );
    barsWrap.append(row);
  }
  card.append(barsWrap);

  // Running-product table: bucket | multiplier | cumulative product.
  const productTable = el('table', { class: 'w-full text-[11px] mt-4 border-t border-zinc-800 pt-3' });
  productTable.append(el('thead', {},
    el('tr', { class: 'text-[10px] uppercase tracking-wide text-zinc-500' },
      el('th', { class: 'text-left py-1 font-normal' }, 'Bucket'),
      el('th', { class: 'text-right py-1 font-normal pl-2' }, 'Factor'),
      el('th', { class: 'text-right py-1 font-normal pl-2' }, 'Running'),
    ),
  ));
  const tbody = el('tbody');
  let running = 1;
  for (const r of rows) {
    running *= r.mult;
    tbody.append(el('tr', { class: 'border-b border-zinc-900' },
      el('td', { class: 'py-1 text-zinc-300 truncate max-w-[180px]' }, r.label),
      el('td', { class: 'py-1 text-right tabular-nums text-zinc-200 pl-2 whitespace-nowrap' }, `×${r.mult.toFixed(2)}`),
      el('td', { class: 'py-1 text-right tabular-nums text-amber-300 pl-2 whitespace-nowrap' }, fmtBigNum(running)),
    ));
  }
  productTable.append(tbody);
  card.append(productTable);

  // Weapon damage anchor row: the breakdown's running product multiplies into the weapon base.
  card.append(el('p', { class: 'text-[10px] text-zinc-500 mt-2 leading-snug' },
    `Multipliers above compound on top of base weapon damage (${fmtNum(c.weaponDmg)}). Hit / Crit / DoT numbers in the Damage card apply this product to that base.`,
  ));

  return card;
}

function statsCard() {
  const c = calc(build);
  const cls = classFor(build);
  const card = sectionCard('Stats Summary');
  // Helpers:
  //   bonus(n)  -> "+X.X%" style number for additive/bonus values (matches in-game stats sheet)
  //   ofBase(n) -> total as % of base damage (for final-factor things like Skill Damage / standalone product)
  const bonus = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
  const ofBase = (mult: number, digits = 1) => `${(mult * 100).toFixed(digits)}%`;

  // Helper to total a single bucket across all gear/charm/glyph slots (no scenario filtering).
  const sumBucket = (bk: Bucket) => build.slots.reduce((s, slot) =>
    s + slot.affixes.filter(a => a.bucket === bk).reduce((ss, a) => ss + a.value, 0), 0);

  // Combined +% Critical Strike Damage: Baseline Stats line + gear CRITADD bucket.
  // Both stack into the same additive bucket on crit hits, so showing them as one row matches
  // how the calc actually uses them.
  const baselineCrit = build.additiveLines.find(l => l.id === 'crit')?.value ?? 0;
  const critDmgAdditive = baselineCrit + sumBucket('CRITADD');

  // Other additive lines from Baseline Stats (non-crit-only ones). Each entered % shows as its own row.
  // We use the line's user-facing label, prefixed with `+%`, so it reads like a stats-sheet entry.
  // Skip DoT-only lines in non-DoT mode (they wouldn't apply); skip non-applicable lines if all-zero.
  const baselineAdditiveRows: [string, string][] = [];
  for (const l of build.additiveLines) {
    if (l.isCritOnly) continue;
    if ((l as any).isDotOnly && !build.disableCrit) continue;
    if (l.value === 0) continue;
    baselineAdditiveRows.push([`+% ${l.label}`, bonus(l.value)]);
  }
  // Custom "Other additive" entries (ADDITIVE bucket) go in a single combined row.
  const otherAdditive = sumBucket('ADDITIVE');

  // Other bucket totals (only render if non-zero so the card stays scannable).
  const nonPhysSum = sumBucket('NONPHYS');

  // Order: computed totals first, then dropdown order (alphabetical by label),
  // then custom buckets (ADDITIVE = "Other additive", EXTRAMULT = "Standalone product") last.
  const stats: [string, string][] = [];

  // --- Computed totals (raw numbers, no +/x prefix) ---
  stats.push(['Weapon Damage', c.weaponDmg ? fmtNum(c.weaponDmg) : 'pick weapon']);
  stats.push([cls.mainStat, fmtNum(c.mainStatSum)]);
  stats.push(['Skill Ranks', String(c.totalSkillRanks)]);
  stats.push(['Skill Damage', ofBase(c.skillCoef)]);

  const isDotMode = build.disableCrit;

  // --- Dropdown order (matches the affix select alphabetical sort) ---
  // + Critical Strike Chance (skip entirely in DoT mode — DoTs can't crit)
  if (!isDotMode) {
    stats.push(['+% Critical Strike Chance', bonus(c.critChance, 1)]);
    if (critDmgAdditive !== 0) stats.push(['+% Critical Strike Damage (crit only)', bonus(critDmgAdditive)]);
  }
  // Other +% damage lines from Baseline Stats (Vulnerable, All, Element, Elites, etc.).
  // In DoT mode, also surface the DoT-only line(s); in hit/crit mode, hide them (they wouldn't apply).
  for (const r of baselineAdditiveRows) stats.push(r);
  // x% multipliers in alphabetical order (matches dropdown). Weapon gem already sums into the
  // ALLM bucket internally, so it's reflected in the All / Element row; no separate gem row needed.
  stats.push(['x% All / Element Damage Multiplier', bonus(c.allm - 1)]);
  if (!isDotMode) stats.push(['x% Critical Strike Damage Multiplier', bonus(c.csdm - 1)]);
  // DoT bucket always shown in DoT mode (even if 0, so user sees the dial they'd be tuning); otherwise only if non-trivial.
  if (isDotMode || c.dotm > 1) stats.push(['x% Damage Over Time Multiplier', bonus(c.dotm - 1)]);
  if (nonPhysSum !== 0) stats.push(['x% Non-Physical Damage', bonus(nonPhysSum)]);
  stats.push(['x% Vulnerable Damage Multiplier', bonus(c.vdm - 1)]);

  // --- Custom buckets last (matches dropdown order with Custom [+]% / [x]% at end) ---
  if (otherAdditive !== 0) stats.push(['Other additive damage (Custom +%)', bonus(otherAdditive)]);
  if (c.extraMultProduct !== 1) stats.push(['Combined [x]% multipliers (aspects, paragon, set, etc.)', `×${c.extraMultProduct.toFixed(2)}`]);
  const tbl = el('table', { class: 'w-full text-xs' });
  for (const [l, v] of stats) {
    tbl.append(el('tr', {},
      el('td', { class: 'py-0.5 text-zinc-500' }, l),
      el('td', { class: 'py-0.5 text-right tabular-nums text-zinc-300' }, v),
    ));
  }
  card.append(tbl);
  return card;
}

// ---------- Footer: formula card (KaTeX rendered) ----------
function formulaCard() {
  const card = el('section', { class: 'bg-zinc-900/30 border border-zinc-800 rounded-lg p-4 sm:p-6 text-sm text-zinc-300' });
  card.append(el('h2', { class: 'text-sm font-semibold text-zinc-300 uppercase tracking-wide mb-3' }, 'How the formula works'));
  card.append(el('p', { class: 'mb-4' },
    'D4 damage is a single product of factors. Each factor (a "bucket") is either a sum of additive % values or a single multiplier. The marginal value of an affix is approximately ',
    katexInline('\\Delta / B'), ', where ', katexInline('B'), ' is the bucket\'s current value. Smaller buckets give bigger gains: at sizes ',
    katexInline('A'), ' and ', katexInline('B'),
    ', the same affix is worth ', katexInline('B / A'), ' times more in the smaller bucket, so a balanced spread of multipliers maximizes the product (',
    Object.assign(el('a', { href: 'https://en.wikipedia.org/wiki/Inequality_of_arithmetic_and_geometric_means', target: '_blank', class: 'text-amber-400 hover:underline' }), { textContent: 'AM-GM inequality' }), ').',
  ));

  // Main formula. Use plain symbols, not in-build jargon.
  const divisor = classFor(build).divisor;
  const formula = String.raw`D = W \cdot (1 + A) \cdot \left(1 + \frac{S}{${divisor}}\right) \cdot C \cdot \prod_{i} M_i \cdot (1.5 \cdot M_{crit})^{c} \cdot (1.2 \cdot M_{vuln})^{v} \cdot M_{dot}^{d} \cdot M_{all} \cdot (1 - R)`;
  card.append(el('div', { class: 'my-4 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0' },
    el('div', { class: 'flex justify-center min-w-max' }, katexBlock(formula))
  ));

  // Worked example with current build values (decimals only).
  card.append(buildPluggedIn());

  card.append(el('p', { class: 'text-xs text-zinc-500 mt-4' },
    'Methodology, formulas, weapon damage values, and stacking rules: ',
    Object.assign(el('a', { href: 'https://www.youtube.com/watch?v=2GKhCdxxqp8', target: '_blank', class: 'text-amber-400 hover:underline' }), { textContent: 'Avarilyn: Damage Calculation Explained with Proof' }),
    ' / ',
    Object.assign(el('a', { href: 'https://www.youtube.com/watch?v=as8y_zGlPrs', target: '_blank', class: 'text-amber-400 hover:underline' }), { textContent: 'How to Optimize Damage' }),
    ' / ',
    Object.assign(el('a', { href: 'https://docs.google.com/spreadsheets/d/1qM6XySdTPuoCF4pEndWihBy0oONayRwZZ9WePkn_TFU/', target: '_blank', class: 'text-amber-400 hover:underline' }), { textContent: 'Original Sheet' }),
    ' \u00b7 ',
    Object.assign(el('a', { href: 'https://github.com/jlian/d4-damage-calc', target: '_blank', class: 'text-amber-400 hover:underline' }), { textContent: 'GitHub source' }),
    '.',
  ));

  return card;
}

// @ts-ignore unused
function additiveBreakdown(b: Build, conds: any): string {
  // Kept for backward compat; description-only short version
  const parts: string[] = [];
  for (const l of b.additiveLines) {
    if (l.isCritOnly) continue;
    if (l.applies(conds) && l.value > 0) parts.push(`${l.label} ${(l.value*100).toFixed(0)}%`);
  }
  let slotAdd = 0;
  for (const slot of b.slots) for (const aa of slot.affixes) if (aa.bucket === 'ADDITIVE') slotAdd += aa.value;
  if (slotAdd > 0) parts.push(`gear/extras ${(slotAdd*100).toFixed(1)}%`);
  return parts.length ? ` (sum of ${parts.join(', ')})` : '';
}

function additiveBreakdownMath(b: Build, conds: any, includeCrit: boolean): string {
  const parts: string[] = [];
  for (const l of b.additiveLines) {
    if (l.isCritOnly && !includeCrit) continue;
    if (l.applies({ ...conds, isCrit: includeCrit }) && l.value > 0) parts.push(l.value.toFixed(2));
  }
  let slotAdd = 0, slotCritAdd = 0;
  for (const slot of b.slots) for (const aa of slot.affixes) {
    if (aa.bucket === 'ADDITIVE') slotAdd += aa.value;
    if (aa.bucket === 'CRITADD' && includeCrit) slotCritAdd += aa.value;
  }
  if (slotAdd > 0) parts.push(slotAdd.toFixed(2));
  if (slotCritAdd > 0) parts.push(slotCritAdd.toFixed(2));
  return parts.length ? `1 + ${parts.join(' + ')}` : '';
}

function bucketBreakdownMath(b: Build, bucket: 'CSDM' | 'VDM' | 'DOTM' | 'ALLM'): string {
  const parts: string[] = [];
  for (const slot of b.slots) for (const aa of slot.affixes) {
    if (aa.bucket === bucket && aa.value !== 0) parts.push(aa.value.toFixed(2));
    if (bucket === 'ALLM' && (aa.bucket === 'NONPHYS' || aa.bucket === 'GEM') && aa.value !== 0) parts.push(aa.value.toFixed(2));
  }
  return parts.length ? `1 + ${parts.join(' + ')}` : '1';
}

function extraMultMath(b: Build): string {
  const factors: { label: string; v: number }[] = [];
  for (const slot of b.slots) for (const aa of slot.affixes) {
    if (aa.bucket === 'EXTRAMULT' && aa.value !== 0) factors.push({ label: aa.label || '?', v: 1 + aa.value });
  }
  if (factors.length === 0) return '';
  // Inline the math. Okay even if many factors; multi-line will wrap in the cell.
  return factors.map(f => f.v.toFixed(2)).join(' × ');
}

function buildPluggedIn(): HTMLElement {
  const wrap = el('div', { class: 'my-4' });
  const c = calc(build);
  if (c.weaponDmg === 0) {
    wrap.append(el('p', { class: 'text-xs text-zinc-500' }, 'Pick a weapon type to see the formula with your numbers.'));
    return wrap;
  }
  const cls = classFor(build);
  const isDotMode = build.disableCrit;
  // Use the same scenario state as the Damage card so user can experiment from one place.
  // In DoT mode, additive is computed with isDot=true so DoT-only lines (Damage Over Time) get included
  // and crit-only lines get excluded — matches what `scenarioDamage` actually does.
  const conds = { ...scenarioState };
  const dotConds: any = { ...conds, isDot: isDotMode };
  const additive = additiveForScenario(build, dotConds);
  const critAdd = isDotMode ? 0 : critOnlyAdditive(build);
  const vdmFactor = conds.vulnerable ? c.vdm * 1.2 : 1;
  const base = c.weaponDmg * c.mainStatMult * vdmFactor * c.allm * c.skillCoef * c.extraMultProduct * build.enemyDamageFactor;
  const nonCritDmg = base * (1 + additive);
  const critDmg = base * (1 + additive + critAdd) * c.csdm * 1.5;
  const dotDmg = base * (1 + additive) * c.dotm;
  const avgDmg = isDotMode ? dotDmg : (critDmg * c.critChance + nonCritDmg * (1 - c.critChance));

  // Format numbers without comma thousand separators (math notation), with fixed decimals
  const dec = (n: number, d = 2) => n.toFixed(d);
  const hi = (s: string) => `<span class="text-amber-400 font-mono">${s}</span>`;

  // One table: Symbol matches the formula exactly | Description (text) | math (intermediate) | result (decimal)
  const tbl = el('table', { class: 'w-full text-xs my-3 block sm:table' });
  tbl.append(el('thead', { class: 'hidden sm:table-header-group' }, el('tr', { class: 'text-xs text-zinc-500 border-b border-zinc-800' },
    el('th', { class: 'text-left py-1 font-normal w-32' }, 'Factor'),
    el('th', { class: 'text-left py-1 font-normal' }, 'Description'),
    el('th', { class: 'text-right py-1 font-normal whitespace-nowrap' }, 'Math'),
    el('th', { class: 'text-right py-1 font-normal pl-3 whitespace-nowrap' }, 'Value'),
  )));
  type RowDesc = string | (string | Node)[];
  type Row = [string, RowDesc, string, number];
  const usedAdd = additive + critAdd;
  // additiveBreakdownMath needs to know which conditional lines to include. In DoT mode, pass isDot=true via conds.
  const addMath = additiveBreakdownMath(build, dotConds, !isDotMode);
  // Skill coef step formula at N total ranks: base × (1 + 0.10 × (N - floor(N/5) - 1) + 0.15 × floor(N/5))
  const N = c.totalSkillRanks;
  const f = Math.floor(N / 5);
  const skillStep = N > 0 ? 1 + 0.10 * (N - f - 1) + 0.15 * f : 1;
  const skillMath = N > 0
    ? `${dec(build.skillDamagePct)} × (1 + 0.10×(${N}-${f}-1) + 0.15×${f}) = ${dec(build.skillDamagePct)} × ${dec(skillStep)}`
    : `${dec(build.skillDamagePct)} × 1`;
  const csdmMath = bucketBreakdownMath(build, 'CSDM');
  const vdmMath = bucketBreakdownMath(build, 'VDM');
  const allmMath = bucketBreakdownMath(build, 'ALLM');
  const manualWepDmgPctSum = build.slots.reduce((s, slot) => s + slot.affixes.filter(a => a.bucket === 'WEPDMG_PCT').reduce((ss, a) => ss + a.value, 0), 0);
  const shieldInnateWepDmgPct = build.slots.some(s => s.weaponTypeId === 'shield') ? 1.0 : 0;
  const wepDmgPctSum = manualWepDmgPctSum + shieldInnateWepDmgPct;
  const rows: Row[] = [
    ['W',
      wepDmgPctSum > 0
        ? ['Average weapon damage from your equipped weapon(s), boosted by ', katexInline('+\\%'), ' Weapon Damage Bonus affixes (shield innate, Herald of Zakarum, etc.). Combined as ', katexInline('W_{base} \\cdot (1 + \\Sigma)'), '.']
        : 'Average weapon damage from your equipped weapon(s).',
      wepDmgPctSum > 0 ? `× (1 + ${dec(wepDmgPctSum)})` : '',
      c.weaponDmg],
    ['(1 + A)',
      critAdd > 0
        ? ['Additive damage bucket. On a crit, includes the ', katexInline('+\\%'), ' Crit Damage additive too; non-crit hits use just the base bucket.']
        : 'Sum of all additive damage % bonuses.',
      addMath || `1 + ${dec(usedAdd)}`, 1 + usedAdd],
    [`(1 + S/${cls.divisor})`,
      [`${cls.mainStat} multiplier. Divisor is `, katexInline(String(cls.divisor)), ` for ${build.classId} (Barbarian uses `, katexInline('900'), ', all others ', katexInline('800'), ').'],
      `1 + ${dec(c.mainStatSum, 0)}/${cls.divisor}`, c.mainStatMult],
    ['C',
      ['Skill damage coefficient. Step formula: ', katexInline(String.raw`\text{base} \cdot \left(1 + 0.10 \cdot (N - \lfloor N/5 \rfloor - 1) + 0.15 \cdot \lfloor N/5 \rfloor\right)`), ' where ', katexInline('N'), ' = total ranks. Every multiple of 5 ranks gets a ', katexInline('+5\\%'), ' bonus on top.'],
      skillMath, c.skillCoef],
    [String.raw`\prod_i M_i`,
      'Product of standalone aspect/unique multipliers. Each one is its own factor.',
      extraMultMath(build), c.extraMultProduct],
  ];
  // Crit / DoT factor: swap rows based on mode. Both branches keep the same overall row count
  // so the formula card layout stays consistent.
  if (isDotMode) {
    rows.push([String.raw`M_{dot}^d`,
      ['DoT factor: Damage Over Time Multiplier bucket. Active only on DoT ticks (', katexInline('d = 1'), '). Crit factor is inactive because DoT skills cannot crit.'],
      bucketBreakdownMath(build, 'DOTM'), c.dotm]);
  } else {
    rows.push([String.raw`(1.5 \cdot M_{crit})^c`,
      ['Crit factor: ', katexInline('1.5'), ' inherent crit baseline times the Critical Strike Damage Multiplier bucket. Active only on crit hits (', katexInline('c = 1'), ').'],
      `1.5 × (${csdmMath})`, c.csdm * 1.5]);
  }
  rows.push([String.raw`(1.2 \cdot M_{vuln})^v`,
    ['Vulnerable factor: ', katexInline('1.2'), ' inherent vuln baseline times the Vulnerable Damage Multiplier bucket. Active only against vulnerable targets (', katexInline('v = 1'), ').'],
    conds.vulnerable ? `1.2 × (${vdmMath})` : 'inactive (v = 0)', vdmFactor]);
  rows.push(['M_{all}',
    'All / Element Damage Multiplier bucket. Includes weapon gem damage which sums into this bucket.',
    allmMath, c.allm]);
  rows.push(['(1 - R)',
    ['Enemy damage reduction. ', katexInline('R = 0.80'), ' for a level-appropriate enemy / training dummy (80% reduction).'],
    `1 - 0.80`, build.enemyDamageFactor]);

  const tb = el('tbody', { class: 'block sm:table-row-group' });
  for (const [sym, desc, math, val] of rows) {
    const descCell = el('td', { class: 'block sm:table-cell py-1 text-zinc-400 align-top order-3' });
    if (Array.isArray(desc)) descCell.append(...desc);
    else descCell.append(desc);
    tb.append(el('tr', { class: 'flex flex-wrap sm:table-row border-b border-zinc-800 sm:border-zinc-900 align-top py-3 sm:py-0 gap-x-3' },
      el('td', { class: 'block sm:table-cell py-1 sm:pr-3 align-top order-1 text-sm sm:text-xs' }, katexInline(sym)),
      descCell,
      el('td', { class: 'block sm:table-cell w-full sm:w-auto py-1 text-left sm:text-right text-zinc-500 font-mono tabular-nums sm:pl-2 align-top order-4 break-all sm:break-normal text-[11px] sm:text-xs' }, math),
      el('td', { class: 'block sm:table-cell py-1 ml-auto sm:ml-0 text-right font-mono text-amber-400 tabular-nums whitespace-nowrap sm:pl-3 align-top order-2 text-base sm:text-xs font-semibold sm:font-normal' }, dec(val, 2)),
    ));
  }
  tbl.append(tb);
  wrap.append(tbl);

  // (Dropped the substituted equation walk-through. Rounding to 2 decimals across 9+ factors
  // accumulates ~0.5% drift, which made the printed result not match a calculator. The precise
  // value below is from internal full-precision math.)
  // Big result (precise, from internal full-precision math). DoT mode shows the DoT tick directly
  // and skips the average-with-crit footer since crit chance is forced to 0.
  if (isDotMode) {
    wrap.append(el('div', { class: 'mt-3 pt-3 border-t border-zinc-800 flex items-baseline justify-between' },
      el('span', { class: 'text-sm text-zinc-300' }, 'DoT tick damage'),
      el('span', { class: 'text-2xl font-bold text-emerald-400 font-mono' }, fmtBigNum(dotDmg)),
    ));
  } else {
    wrap.append(el('div', { class: 'mt-3 pt-3 border-t border-zinc-800 flex items-baseline justify-between' },
      el('span', { class: 'text-sm text-zinc-300' }, `Crit hit damage`),
      el('span', { class: 'text-2xl font-bold text-amber-400 font-mono' }, fmtBigNum(critDmg)),
    ));
    wrap.append(el('div', { class: 'text-xs text-zinc-500 mt-2' }, `Average (with ${(c.critChance*100).toFixed(0)}% crit chance) = ${fmtBigNum(avgDmg)}`));
  }
  void hi; // unused helper
  return wrap;
}

function katexInline(tex: string): HTMLElement {
  const span = el('span', { class: 'inline-block' });
  katex.render(tex, span, { throwOnError: false, displayMode: false });
  return span;
}
function katexBlock(tex: string): HTMLElement {
  const div = el('div', { class: 'inline-block' });
  katex.render(tex, div, { throwOnError: false, displayMode: true });
  return div;
}

// ---------- header buttons ----------
function copyShareBtn() {
  const btn = el('button', { class: 'text-xs px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-zinc-950 font-medium', title: 'Copy a shareable link that encodes the current build' }, 'Copy Share Link');
  btn.addEventListener('click', async () => {
    const url = buildShareUrl(build);
    try { await navigator.clipboard.writeText(url); }
    catch { prompt('Copy this link:', url); }
    const old = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = old; }, 1500);
  });
  return btn;
}

function snapshotBtn() {
  // Single primary action: "Save Build". When something has changed since last save,
  // show an amber dot prefix ("● Save Build") — same dirty-state convention as VSCode / Figma / browsers.
  // Clicking always overwrites the saved build, no confirmation needed (Restore Saved is the undo).
  const saved = build.snapshot;
  const dirty = !!saved && !buildsEqualForCompare(build, saved);
  const isFresh = !!saved && !dirty;
  const label = saved ? (dirty ? 'Save Build' : 'Saved') : 'Save Build';
  const title = saved
    ? (dirty ? 'Overwrite the saved build with the current one' : 'Current build matches the saved one')
    : 'Save the current build so you can compare future edits against it';
  const baseCls = 'text-xs px-3 py-1.5 rounded inline-flex items-center gap-1.5 transition ';
  const stateCls = dirty
    ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40'
    : isFresh
      ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 cursor-default'
      : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-transparent';
  const btn = el('button', { class: baseCls + stateCls, title }, label);
  if (dirty) btn.prepend(el('span', { class: 'w-1.5 h-1.5 rounded-full bg-amber-400 inline-block' }));
  else if (isFresh) btn.prepend(el('span', { class: 'text-xs leading-none' }, '✓'));
  else btn.prepend(el('span', { class: 'text-xs leading-none' }, '💾'));
  btn.addEventListener('click', () => {
    if (isFresh) return; // no-op: nothing to overwrite
    const snap = cloneBuild(build); snap.snapshot = null;
    build.snapshot = snap;
    persist(build);
    mount();
  });
  return btn;
}

function restoreSnapshotBtn() {
  if (!build.snapshot) return el('span', { class: 'hidden' });
  // Only meaningful when current diverges from saved. If they match, there's nothing to restore.
  if (buildsEqualForCompare(build, build.snapshot)) return el('span', { class: 'hidden' });
  const btn = el('button', { class: 'text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300', title: 'Discard current edits and revert to the saved build' }, '↩ Restore Saved');
  btn.addEventListener('click', () => {
    if (!build.snapshot) return;
    if (!confirm('Replace the current build with the saved one? Unsaved edits will be lost.')) return;
    // Preserve the saved build on the restored copy so the Save button flips back to green "✓ Saved"
    // (current == saved) instead of resetting to neutral. Re-saves the same snapshot reference.
    const savedCopy = cloneBuild(build.snapshot);
    savedCopy.snapshot = null;
    const restored = cloneBuild(build.snapshot);
    restored.snapshot = savedCopy;
    build = restored;
    persist(build);
    mount();
  });
  return btn;
}

function jsonBtn() {
  const btn = el('button', { class: 'text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300', title: 'View / edit / copy build JSON' }, '{ } JSON');
  btn.addEventListener('click', () => openJsonDialog());
  return btn;
}

function loadSampleBtn() {
  const btn = el('button', { class: 'text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300', title: 'Load a fully-populated sample build (Paladin / Blessed Hammer)' }, '✨ Sample build');
  btn.addEventListener('click', () => {
    const isEmpty = build.baseMainStat === 0 && build.skillDamagePct === 0
      && build.slots.every(s => s.affixes.length === 0 && (s.weaponTypeId ?? 'none') === 'none');
    if (!isEmpty && !confirm('Replace the current build with the sample? Your current build will be lost (Save Build / Reset can recover it).')) return;
    const parsed = importJsonObject(samplePaladin);
    if (!parsed) { alert('Sample build failed to load. (Bug, please report.)'); return; }
    build = parsed;
    persist(build);
    mount();
  });
  return btn;
}

function openJsonDialog() {
  const overlay = el('div', { class: 'fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4' });
  const panel = el('div', { class: 'bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col' });

  const header = el('div', { class: 'flex items-center justify-between px-4 py-3 border-b border-zinc-800' },
    el('h3', { class: 'text-sm font-medium text-zinc-200' }, 'Build JSON'),
    Object.assign(el('button', { class: 'text-zinc-500 hover:text-zinc-200 text-lg leading-none', 'aria-label': 'Close' }), { textContent: '✕' }),
  );
  (header.lastChild as HTMLElement).addEventListener('click', () => overlay.remove());

  const ta = el('textarea', {
    class: 'flex-1 min-h-[300px] w-full bg-zinc-950 text-zinc-200 text-xs font-mono p-3 rounded border border-zinc-800 focus:outline-none focus:border-amber-600 resize-none',
    spellcheck: 'false',
  }) as HTMLTextAreaElement;
  ta.value = exportJson(build);

  const status = el('span', { class: 'text-xs text-zinc-500' }, '');

  const copyBtn = el('button', { class: 'text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300' }, 'Copy');
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ta.value); status.textContent = 'Copied to clipboard'; status.className = 'text-xs text-emerald-400'; }
    catch { status.textContent = 'Copy failed, select & copy manually'; status.className = 'text-xs text-red-400'; }
  });

  const applyBtn = el('button', { class: 'text-xs px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-zinc-950 font-medium' }, 'Apply');
  applyBtn.addEventListener('click', () => {
    const parsed = importJson(ta.value);
    if (!parsed) { status.textContent = 'Invalid JSON, not applied'; status.className = 'text-xs text-red-400'; return; }
    build = parsed;
    persist(build);
    mount();
    overlay.remove();
  });

  const cancelBtn = el('button', { class: 'text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300' }, 'Close');
  cancelBtn.addEventListener('click', () => overlay.remove());

  const body = el('div', { class: 'flex-1 flex flex-col min-h-0 p-4 gap-3' });
  body.append(
    el('p', { class: 'text-xs text-zinc-500' }, 'Edit the JSON and click Apply to load it. Copy to share or back up.'),
    ta,
    el('div', { class: 'flex items-center justify-between gap-2 flex-wrap' },
      status,
      el('div', { class: 'flex gap-2' }, copyBtn, applyBtn, cancelBtn),
    ),
  );

  panel.append(header, body);
  overlay.append(panel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  // Focus textarea so the user can immediately edit / select-all.
  setTimeout(() => ta.focus(), 0);
}

function resetBtn() {
  const btn = el('button', { class: 'text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300' }, 'Reset');
  btn.addEventListener('click', () => {
    if (!confirm('Reset to defaults?')) return;
    localStorage.removeItem('d4bc.build');
    window.location.hash = '';
    window.location.reload();
  });
  return btn;
}

window.addEventListener('hashchange', () => { build = loadInitialBuild(); mount(); });
mount();
