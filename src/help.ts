// Centralized help text for tooltips + the in-app help modal.
// Keys are stable string ids so the same string can be reused from the modal "Field reference"
// section and from the per-input ⓘ tooltip.

export const FIELD_HELP: Record<string, string> = {
  // ---- Class / skill / baseline numeric inputs ----
  class:
    'Your class. Picks the right main stat (Str/Dex/Int/Will), available weapon types, and divisor for the main-stat formula.',
  skillDamagePct:
    "The skill's tooltip damage at rank 1 (e.g. 115 for Blessed Hammer). Look it up on Maxroll or d4builds.gg if unsure. Don't enter the displayed rank-N value — the calc scales by rank for you.",
  totalSkillRanks:
    'Total ranks in the active skill while naked (no gear). Usually around 15 for a maxed-out base skill. Extra ranks from gear go in the affix rows on each gear slot.',
  skillWeaponSlot:
    "Which equipped weapon's base damage drives this skill. Auto = sum all weapons (legacy behavior, fine for single-weapon classes). Pick a specific slot for skills like Hammer of the Ancients that always use one weapon.",

  baseMainStat:
    "Your total main stat (Str/Dex/Int/Will) while completely naked. This captures level + paragon nodes + glyphs only — strip all gear, charms, and the Horadric Seal before reading this from your stats sheet.",

  baseCritChance:
    "Critical Strike Chance from your stats sheet's BOTTOM tooltip line (the +X% from items and Paragon). The inherent 5% base crit is already baked into the formula.",

  // ---- Additive lines (Baseline Stats) ----
  // Read from the stats sheet "+X% from items and Paragon" bottom-tooltip line.
  add_crit:
    'Total +% Critical Strike Damage from items + paragon (the additive bucket that only applies on crit hits). Read the BOTTOM tooltip line on your stats sheet.',
  add_vulnerable:
    'Additive +% Vulnerable Damage from items + paragon. The baseline 1.20x on vulnerable targets is already baked into the formula — do not add it here.',
  add_all:
    'Additive +% All Damage (the catch-all line on your stats sheet).',
  add_primaryElem:
    'Additive +% Damage with your primary element (Fire/Cold/Lightning/Shadow/Poison/Holy). One line is fine for most builds; if you have multiple elements active, sum them.',
  add_overTime:
    'Additive +% Damage Over Time. Only applies in DoT mode (flip the DoT skill toggle in the Damage card).',
  add_close:
    'Additive +% Damage vs Close enemies. Only counts when the Close target chip is toggled on.',
  add_distant:
    'Additive +% Damage vs Distant enemies. Only counts when the Distant chip is on.',
  add_elites:
    'Additive +% Damage vs Elites. Only counts when the Elite chip is on.',
  add_cc:
    'Additive +% Damage vs Crowd Controlled enemies. Only counts when the CC chip is on.',
  add_custom:
    "For additive damage lines on your in-game stats sheet that aren't in the default list (e.g. Damage with Imbued, Damage vs Healthy). Treated as always-on.",

  // ---- Gear slot / affix UI ----
  slot_weaponType:
    "Pick the weapon family in this slot. Sets the built-in base damage and attack speed. Choose 'None' to leave the slot empty.",
  affix_bucket:
    'Which damage bucket this affix lands in. Same-bucket affixes add; cross-bucket affixes multiply. Pick wrong and the affix will be over/undervalued.',
  affix_value:
    "The affix's % or flat value. For % buckets enter the percent (10 = 10%); for flat buckets enter the raw number.",
  affix_label:
    'Optional descriptor so you remember what this entry represents (e.g. "Heir of Perdition", "Berserking glyph").',
  aspect_row:
    "Legendary aspect (or unique effect) on this item. Pick the bucket the aspect contributes to — most are Custom [x]%; some add to Crit Damage / Main Stat / etc.",
  gem_armor:
    'Royal gem in this armor socket. The +Main Stat value (90 by default for Royal).',
  gem_weapon:
    'Royal gem in this weapon socket. Adds to the All / Element multiplier bucket (24% by default for Royal).',

  // ---- Glyph slot ----
  glyph_row:
    'Each glyph has up to 3 sources. Enter ONLY the legendary bonus (bottom line) here. The additive part is already in the Baseline Stats card above.',

  // ---- Paragon / Other multipliers ----
  paragon_row:
    "Long-tail damage from paragon legendary/rare nodes, key passives, auras, sacrifices, etc. — anything not already captured in gear/charms/glyphs/stats sheet. Use Custom [x]% for conditional 'damage while berserking' style multipliers.",

  // ---- Scenario toggles ----
  scenario_dot:
    "Flip on for DoT skills (Poison Spray, Bleed, Ignite, etc.). DoTs can't crit; the readout becomes the DoT tick, additive lines marked 'Damage Over Time' apply, and Upgrade Priority swaps crit-centric affixes for DoT-centric ones.",
  scenario_vulnerable:
    'Treat the target as Vulnerable (yellow outline). Applies the baseline 1.20x and your Vulnerable Damage Multiplier bucket.',
  scenario_elites:
    "Treat the target as an Elite. Activates your 'Damage vs Elites' additive line.",
  scenario_close:
    "Treat the target as Close. Activates your 'Damage vs Close' additive line.",
  scenario_distant:
    "Treat the target as Distant. Activates your 'Damage vs Distant' additive line.",
  scenario_cc:
    "Treat the target as Crowd Controlled. Activates your 'Damage vs Crowd Controlled' additive line.",

  // ---- Other / global ----
  customExtraMult:
    "Custom [x]% multipliers — one row per source. Each multiplies the final damage independently (joins its own bucket). Use for paragon legendary nodes, set bonuses, conditional 'damage while X' multipliers.",
};

// Small ⓘ icon next to a label that surfaces a help string via the native `title` attribute.
// Uses an inline span styled with Tailwind so it inherits font sizing from its parent label.
export function helpIcon(key: string): HTMLSpanElement | null {
  const text = FIELD_HELP[key];
  if (!text) return null;
  const span = document.createElement('span');
  span.className = 'inline-flex items-center justify-center text-zinc-500 hover:text-zinc-300 cursor-help select-none ml-1';
  span.title = text;
  span.setAttribute('aria-label', text);
  span.textContent = 'ⓘ';
  return span;
}

// Help-modal content authored as an HTML string so the existing KaTeX-rendered help doesn't need
// an extra markdown dependency. Tailwind classes provide styling.
export function helpModalHTML(): string {
  const fieldRows = Object.entries(FIELD_HELP)
    .map(([k, v]) =>
      `<tr class="border-b border-zinc-800 align-top">
         <td class="py-1 pr-3 text-zinc-300 font-mono text-[11px] whitespace-nowrap">${escapeHtml(k)}</td>
         <td class="py-1 text-zinc-400 text-xs">${escapeHtml(v)}</td>
       </tr>`,
    )
    .join('');

  return `
    <div class="prose prose-invert prose-sm max-w-none space-y-5 text-zinc-300">
      <section>
        <h3 class="text-amber-300 text-base font-semibold mb-2">What this is</h3>
        <p class="text-sm leading-relaxed">
          A static Diablo 4 damage calculator that follows the bucket model popularized by
          <a class="text-amber-400 hover:underline" href="https://www.youtube.com/@avarilyn" target="_blank" rel="noreferrer">Avarilyn</a>'s
          video + spreadsheet. Enter your build, see total damage, and (more importantly) see which
          upgrade is most valuable next. Web port lives on
          <a class="text-amber-400 hover:underline" href="https://github.com/jlian/d4-bucket-calc" target="_blank" rel="noreferrer">GitHub</a>.
        </p>
      </section>

      <section>
        <h3 class="text-amber-300 text-base font-semibold mb-2">The bucket system in 3 sentences</h3>
        <ul class="text-sm space-y-1 list-disc list-inside marker:text-zinc-600">
          <li>D4 damage = a single product of independent multiplier <em>buckets</em>.</li>
          <li>Within one bucket, bonuses <strong>add</strong>; across buckets, they <strong>multiply</strong>.</li>
          <li>A 10% bonus is worth more in a <em>small</em> bucket than a big one — that's why diversifying your multipliers matters more than stacking the same one.</li>
        </ul>
      </section>

      <section>
        <h3 class="text-amber-300 text-base font-semibold mb-2">How to use this tool</h3>
        <ol class="text-sm space-y-1 list-decimal list-inside marker:text-zinc-600">
          <li>Pick your class and skill, then enter the skill's <em>rank-1</em> base damage % (look it up on Maxroll / d4builds.gg).</li>
          <li>Strip all gear / charms / seal and read your <strong>naked</strong> Main Stat + Crit Chance + Crit Damage (and every other additive line) from the stats sheet. Always copy the <em>bottom</em> tooltip line ("+X% from items and Paragon"), never the top.</li>
          <li>Re-equip. Fill in each gear slot's affixes one row at a time. Pick the right bucket from the dropdown — same-named affixes share a bucket.</li>
          <li>Use <strong>Paragon &amp; Other Multipliers</strong> for any source not covered by a gear affix: paragon legendary nodes, conditional "damage while berserking" effects, key passives, auras, set bonuses. Most of these are Custom [x]%.</li>
          <li>Toggle target conditions (Vulnerable / Elite / Close / Distant / CC) in the Damage card to model the scenario you actually fight in.</li>
          <li>Read the <strong>Upgrade Priority</strong> card to see which affix is worth the most right now.</li>
          <li>Use the new <strong>Damage Multiplier Breakdown</strong> to see how each bucket compounds into the total — the smallest bars are usually your biggest upgrade opportunities.</li>
        </ol>
      </section>

      <section>
        <h3 class="text-amber-300 text-base font-semibold mb-2">Field reference</h3>
        <p class="text-xs text-zinc-500 mb-2">Every input has a ⓘ tooltip too — hover for the same text.</p>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <tbody>${fieldRows}</tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
