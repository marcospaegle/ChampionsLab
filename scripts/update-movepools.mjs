/**
 * Update movepools from Serebii Champions Pokédex.
 * 
 * Phase 1: Fetch all Pokémon pages from Serebii and extract move data.
 * Phase 2: Apply the data to pokemon-data.ts.
 * 
 * Usage: node scripts/update-movepools.mjs
 */

import { parse } from 'node-html-parser';
import { readFileSync, writeFileSync } from 'fs';

const BASE_URL = 'https://www.serebii.net/pokedex-champions';
const DELAY_MS = 600; // polite rate limiting
const DATA_FILE = 'src/lib/pokemon-data.ts';

// ── Extract Pokémon list from pokemon-data.ts ───────────────────────────────
function extractPokemonList() {
  const content = readFileSync(DATA_FILE, 'utf-8');
  // Match top-level id + name pairs (id is first, name follows)
  const regex = /"id":\s*(\d+),\s*\n\s*"name":\s*"([^"]+)"/g;
  const list = [];
  let m;
  while ((m = regex.exec(content)) !== null) {
    list.push({ id: Number(m[1]), name: m[2] });
  }
  return list;
}

// ── Map Pokémon name to Serebii URL slug and section ────────────────────────
function getSerebiiInfo(name) {
  const regions = {
    'Alolan ': { section: 'Alola Form Standard Moves', prefix: 'Alolan ' },
    'Hisuian ': { section: 'Hisuian Form Standard Moves', prefix: 'Hisuian ' },
    'Galarian ': { section: 'Galarian Form Standard Moves', prefix: 'Galarian ' },
  };

  for (const [prefix, info] of Object.entries(regions)) {
    if (name.startsWith(prefix)) {
      const baseName = name.replace(prefix, '');
      return {
        slug: nameToSlug(baseName),
        section: info.section,
      };
    }
  }

  // Rotom forms all share the same page
  const rotomForms = ['Heat Rotom', 'Wash Rotom', 'Frost Rotom', 'Fan Rotom', 'Mow Rotom'];
  if (rotomForms.includes(name)) {
    return { slug: 'rotom', section: 'Standard Moves' };
  }

  // Gendered forms
  if (name === 'Meowstic') {
    return { slug: 'meowstic', section: 'Standard Moves - Male' };
  }
  if (name === 'Basculegion') {
    return { slug: 'basculegion', section: 'Standard Moves - Male' };
  }

  // Floette uses "Eternal Floette" section on Serebii
  if (name === 'Floette') {
    return { slug: 'floette', section: 'Standard Moves - Eternal Floette' };
  }

  return { slug: nameToSlug(name), section: 'Standard Moves' };
}

function nameToSlug(name) {
  // Serebii uses lowercase with special chars preserved
  return name
    .toLowerCase()
    .replace(/[']/g, '') // Remove apostrophes if any
    .replace(/ /g, '');  // Remove spaces (e.g. "Mr. Rime" -> "mr.rime")
}

// ── Fetch a page with retries ───────────────────────────────────────────────
async function fetchPage(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ChampionsLab-DataSync/1.0)',
          'Accept': 'text/html',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      console.warn(`  Retry ${i + 1} for ${url}: ${e.message}`);
      await sleep(2000);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Parse moves from HTML section ───────────────────────────────────────────
function parseMoves(html, sectionTitle) {
  // Find the section by its <h3> title
  const sectionPattern = `<h3>${sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
  // Also try with anchor tag
  const patterns = [
    new RegExp(`<h3>(?:<a[^>]*>\\s*</a>)?\\s*${escapeRegex(sectionTitle)}\\s*</h3>`),
    new RegExp(escapeRegex(sectionTitle) + `</h3>`),
    // Handle leading whitespace in section title (Floette)
    new RegExp(`\\s+${escapeRegex(sectionTitle)}\\s*</h3>`),
  ];

  let sectionIdx = -1;
  for (const pat of patterns) {
    const match = html.match(pat);
    if (match) {
      sectionIdx = html.indexOf(match[0]);
      break;
    }
  }

  if (sectionIdx === -1) {
    return null; // Section not found
  }

  // Extract from the section header to the next section or end of moves
  // Find the end: next <h3> with "Moves" or next "Stats" section or </table> after moves
  const afterSection = html.substring(sectionIdx);
  
  // Find the closing </table> for this dextable section 
  // The moves table starts with the section header and ends at </table>
  // But there might be nested tables... 
  // Better: find the next <h3> after this one (which would be another section)
  const nextH3 = afterSection.indexOf('<h3>', 10); // skip the current <h3>
  const moveHtml = nextH3 !== -1 ? afterSection.substring(0, nextH3) : afterSection;

  // Parse moves from the HTML
  const moves = [];
  const root = parse(moveHtml);
  
  // Find all rows with rowspan="2" (these are move data rows)
  const rows = root.querySelectorAll('tr');
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const firstTd = row.querySelector('td[rowspan="2"]');
    if (!firstTd) continue;

    const anchor = firstTd.querySelector('a');
    if (!anchor) continue;

    const moveName = anchor.text.trim();
    if (!moveName) continue;

    const cells = row.querySelectorAll('td');
    const imgs = row.querySelectorAll('img');

    // Extract type from first img alt: "MoveName - TypeName-type"
    let type = 'normal';
    let category = 'physical';
    
    for (const img of imgs) {
      const alt = img.getAttribute('alt') || '';
      const typeMatch = alt.match(/- (\w+)-type$/);
      if (typeMatch) {
        type = typeMatch[1].toLowerCase();
      }
      const catMatch = alt.match(/: (Physical|Special|Other) Move$/);
      if (catMatch) {
        const cat = catMatch[1].toLowerCase();
        category = cat === 'other' ? 'status' : cat;
      }
    }

    // Extract power and accuracy from <td class="cen"> cells
    const cenCells = row.querySelectorAll('td.cen');
    // cenCells order: type-img, cat-img, power, accuracy, pp, effect
    // But the first two cen cells contain images, then power, accuracy, (pp), effect
    let power = null;
    let accuracy = null;
    let pp = null;

    // Skip the img cells, get the numeric ones
    const numericCells = [];
    for (const cell of cenCells) {
      if (!cell.querySelector('img')) {
        numericCells.push(cell.text.trim());
      }
    }

    // numericCells should be: [power, accuracy, pp, effect]
    if (numericCells.length >= 2) {
      const rawPower = numericCells[0];
      const rawAcc = numericCells[1];
      const rawPP = numericCells[2] || '';

      power = (rawPower === '--' || rawPower === '??' || rawPower === '') ? null : Number(rawPower);
      accuracy = (rawAcc === '--' || rawAcc === '??' || rawAcc === '' || rawAcc === '101') ? null : Number(rawAcc);
      pp = rawPP !== '' ? Number(rawPP) : null;
    }

    // Get description from the next row
    let description = '';
    if (i + 1 < rows.length) {
      const descRow = rows[i + 1];
      const descTd = descRow.querySelector('td.fooinfo[colspan]');
      if (descTd) {
        description = descTd.text.trim();
      }
    }

    moves.push({
      name: moveName,
      type,
      category,
      power,
      accuracy,
      pp,
      description,
    });
  }

  return moves;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Phase 1: Fetch all Serebii data ────────────────────────────────────────
async function fetchAllMoves(pokemonList) {
  const results = {};
  const pageCache = {};
  let count = 0;

  for (const pokemon of pokemonList) {
    count++;
    const info = getSerebiiInfo(pokemon.name);
    const url = `${BASE_URL}/${info.slug}/`;
    
    console.log(`[${count}/${pokemonList.length}] ${pokemon.name} -> ${url} (${info.section})`);

    try {
      // Use cache for shared pages
      if (!pageCache[url]) {
        const html = await fetchPage(url);
        pageCache[url] = html;
        await sleep(DELAY_MS);
      }

      const html = pageCache[url];
      const moves = parseMoves(html, info.section);

      if (!moves || moves.length === 0) {
        console.warn(`  ⚠ No moves found for ${pokemon.name} in section "${info.section}"`);
        results[pokemon.name] = { error: 'no_moves', section: info.section };
      } else {
        console.log(`  ✓ ${moves.length} moves`);
        results[pokemon.name] = { moves, count: moves.length };
      }
    } catch (e) {
      console.error(`  ✗ Error: ${e.message}`);
      results[pokemon.name] = { error: e.message };
    }
  }

  return results;
}

// ── Phase 2: Apply to pokemon-data.ts ──────────────────────────────────────
function applyMoves(serebiiData) {
  let content = readFileSync(DATA_FILE, 'utf-8');
  let changesApplied = 0;
  let movesAdded = 0;
  let movesRemoved = 0;

  for (const [pokemonName, data] of Object.entries(serebiiData)) {
    if (data.error) {
      console.log(`  Skipping ${pokemonName}: ${data.error}`);
      continue;
    }

    const serebiiMoveNames = new Set(data.moves.map(m => m.name));
    
    // Find this Pokémon's moves section in the file
    // Look for "name": "PokemonName" then find the "moves": [ section after it
    const namePattern = `"name": "${escapeRegex(pokemonName)}"`;
    const nameIdx = content.indexOf(`"name": "${pokemonName}"`);
    
    if (nameIdx === -1) {
      console.warn(`  Could not find ${pokemonName} in file`);
      continue;
    }

    // Find "moves": [ after the name
    const movesStart = content.indexOf('"moves": [', nameIdx);
    if (movesStart === -1) {
      console.warn(`  Could not find moves array for ${pokemonName}`);
      continue;
    }

    // Find the matching ] for the moves array
    const arrayStart = content.indexOf('[', movesStart);
    let depth = 0;
    let arrayEnd = -1;
    for (let i = arrayStart; i < content.length; i++) {
      if (content[i] === '[') depth++;
      else if (content[i] === ']') {
        depth--;
        if (depth === 0) {
          arrayEnd = i;
          break;
        }
      }
    }

    if (arrayEnd === -1) {
      console.warn(`  Could not find end of moves array for ${pokemonName}`);
      continue;
    }

    // Parse existing moves to get full data
    const existingMovesStr = content.substring(arrayStart, arrayEnd + 1);
    let existingMoves;
    try {
      existingMoves = JSON.parse(existingMovesStr);
    } catch (e) {
      console.warn(`  Could not parse existing moves for ${pokemonName}: ${e.message}`);
      continue;
    }

    // Build new moves array:
    // 1. Keep existing moves that are in Serebii list (preserve our data)
    // 2. Add Serebii moves that don't exist in our data
    const existingByName = {};
    for (const m of existingMoves) {
      existingByName[m.name] = m;
    }

    const newMoves = [];
    const added = [];
    const kept = [];
    const removed = [];

    // Go through Serebii moves in order
    for (const serebiiMove of data.moves) {
      if (existingByName[serebiiMove.name]) {
        // Move exists in both - keep our existing data
        newMoves.push(existingByName[serebiiMove.name]);
        kept.push(serebiiMove.name);
      } else {
        // New move from Serebii - construct Move object
        const pp = serebiiMove.pp || guessPP(serebiiMove);
        const desc = serebiiMove.description || '';
        newMoves.push({
          name: serebiiMove.name,
          type: serebiiMove.type,
          category: serebiiMove.category,
          power: serebiiMove.power,
          accuracy: serebiiMove.accuracy,
          pp: pp,
          description: desc,
        });
        added.push(serebiiMove.name);
      }
    }

    // Track removed moves
    for (const m of existingMoves) {
      if (!serebiiMoveNames.has(m.name)) {
        removed.push(m.name);
      }
    }

    if (added.length === 0 && removed.length === 0) {
      continue; // No changes needed
    }

    // Determine indentation from existing content
    const lineStart = content.lastIndexOf('\n', movesStart) + 1;
    const indent = content.substring(lineStart, movesStart).match(/^(\s*)/)[1];
    const moveIndent = indent + '  ';

    // Generate new moves JSON
    const newMovesStr = '[\n' + newMoves.map(m => {
      return moveIndent + '  ' + JSON.stringify(m);
    }).join(',\n') + '\n' + moveIndent + ']';

    // Replace in content
    content = content.substring(0, arrayStart) + newMovesStr + content.substring(arrayEnd + 1);

    changesApplied++;
    movesAdded += added.length;
    movesRemoved += removed.length;

    if (added.length > 0 || removed.length > 0) {
      console.log(`  ${pokemonName}: +${added.length} -${removed.length} (${newMoves.length} total)`);
      if (added.length > 0 && added.length <= 10) console.log(`    Added: ${added.join(', ')}`);
      if (removed.length > 0 && removed.length <= 10) console.log(`    Removed: ${removed.join(', ')}`);
    }
  }

  return { content, changesApplied, movesAdded, movesRemoved };
}

function guessPP(move) {
  // Common PP values by power level
  if (move.category === 'status') return 20;
  if (move.power === null) return 20;
  if (move.power >= 120) return 5;
  if (move.power >= 90) return 10;
  if (move.power >= 60) return 15;
  return 20;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Phase 1: Extracting Pokémon list ===');
  const pokemonList = extractPokemonList();
  console.log(`Found ${pokemonList.length} Pokémon\n`);

  console.log('=== Phase 2: Fetching from Serebii ===');
  
  // Check if we have cached data from a previous run
  let serebiiData;
  const cacheFile = 'scripts/serebii-moves.json';
  const useCache = process.argv.includes('--use-cache');
  
  if (useCache) {
    console.log('Using cached data from serebii-moves.json');
    serebiiData = JSON.parse(readFileSync(cacheFile, 'utf-8'));
  } else {
    serebiiData = await fetchAllMoves(pokemonList);
    writeFileSync(cacheFile, JSON.stringify(serebiiData, null, 2));
    console.log('\nSaved raw data to scripts/serebii-moves.json\n');
  }

  // Summary of fetch results
  const successes = Object.values(serebiiData).filter(d => !d.error).length;
  const failures = Object.values(serebiiData).filter(d => d.error).length;
  console.log(`Fetch results: ${successes} success, ${failures} failures\n`);

  if (failures > 15) {
    console.error('Too many failures. Review serebii-moves.json and re-run.');
    process.exit(1);
  }

  console.log('=== Phase 3: Applying changes to pokemon-data.ts ===');
  const result = applyMoves(serebiiData);
  
  if (result.changesApplied > 0) {
    // Backup original
    const backup = readFileSync(DATA_FILE, 'utf-8');
    writeFileSync(DATA_FILE + '.bak', backup);
    console.log(`Backed up original to ${DATA_FILE}.bak`);
    
    writeFileSync(DATA_FILE, result.content);
    console.log(`\n=== Done ===`);
    console.log(`Pokémon updated: ${result.changesApplied}`);
    console.log(`Moves added: ${result.movesAdded}`);
    console.log(`Moves removed: ${result.movesRemoved}`);
  } else {
    console.log('No changes needed.');
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
