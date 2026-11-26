// Physical Tab module for GRAFIK-35
// Preview tab "Физлица" for manual grouping of settlements

// Fingerprint storage key prefix
const PHYSICAL_DECISIONS_PREFIX = 'grafik-to-physical-decisions-';

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export function computeFingerprint(fileName, exportDate, rowCount) {
  const dateStr = exportDate instanceof Date ? exportDate.toISOString().split('T')[0] : String(exportDate || '');
  const base = `${fileName}|${dateStr}|${rowCount}`;
  return simpleHash(base);
}

function getDecisionsKey(fingerprint) {
  return `${PHYSICAL_DECISIONS_PREFIX}${fingerprint}`;
}

export function loadPhysicalDecisions(fingerprint) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const raw = storage.getItem(getDecisionsKey(fingerprint));
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Verify fingerprint matches (defense against corruption)
    if (data.fingerprint !== fingerprint) return null;
    return data.decisions || {};
  } catch {
    return null;
  }
}

export function savePhysicalDecisions(fingerprint, decisions) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    storage.setItem(getDecisionsKey(fingerprint), JSON.stringify({
      fingerprint,
      decisions,
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // Ignore quota/private-mode errors
  }
}

export function clearPhysicalDecisions(fingerprint) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    storage.removeItem(getDecisionsKey(fingerprint));
  } catch {
    // Ignore
  }
}

export function clearAllPhysicalDecisions() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    const keysToRemove = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(PHYSICAL_DECISIONS_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      storage.removeItem(key);
    }
  } catch {
    // Ignore
  }
}

// Build tree structure from physical visits
// Returns { parents: [{ parentKey, parentName, settlements: [{ key, name, persons, units, mode, dates, visits }] }] }
export function buildPhysicalTree(outboundVisits, onsiteVisits, decisions = {}) {
  // Group all physical visits by settlement
  const settlementMap = new Map(); // key -> { name, parentKey, parentName, persons, units, mode, dates, visits }
  
  function getParentKey(stop) {
    // Parent = district (municipality) if present, else city (settlement name)
    // For physical stops, we use the municipality field as district
    return stop.municipality || stop.name;
  }
  
  function getParentName(stop) {
    return stop.municipality || stop.name;
  }
  
  function getSettlementKey(stop) {
    // Use the stop's key/name as settlement identifier
    return stop.key || stop.name;
  }
  
  // Process outbound visits
  for (const visit of outboundVisits) {
    for (const stop of visit.stops || []) {
      const sKey = getSettlementKey(stop);
      const pKey = getParentKey(stop);
      const pName = getParentName(stop);
      
      if (!settlementMap.has(sKey)) {
        settlementMap.set(sKey, {
          key: sKey,
          name: stop.name,
          parentKey: pKey,
          parentName: pName,
          persons: new Set(),
          units: 0,
          mode: 'выезд', // default for outbound
          dates: new Set(),
          visits: [],
          stops: [], // reference to stop objects for merging
        });
      }
      const entry = settlementMap.get(sKey);
      for (const record of stop.records || []) {
        entry.persons.add(record.owner);
        entry.units += 1;
      }
      entry.dates.add(visit.date.toISOString().split('T')[0]);
      entry.visits.push(visit);
      entry.stops.push(stop);
    }
  }
  
  // Process onsite visits
  for (const visit of onsiteVisits) {
    for (const stop of visit.stops || []) {
      const sKey = getSettlementKey(stop);
      const pKey = getParentKey(stop);
      const pName = getParentName(stop);
      
      if (!settlementMap.has(sKey)) {
        settlementMap.set(sKey, {
          key: sKey,
          name: stop.name,
          parentKey: pKey,
          parentName: pName,
          persons: new Set(),
          units: 0,
          mode: 'площадка', // default for onsite
          dates: new Set(),
          visits: [],
          stops: [],
        });
      }
      const entry = settlementMap.get(sKey);
      for (const record of stop.records || []) {
        entry.persons.add(record.owner);
        entry.units += 1;
      }
      entry.dates.add(visit.date.toISOString().split('T')[0]);
      entry.visits.push(visit);
      entry.stops.push(stop);
      entry.mode = 'площадка';
    }
  }
  
  // Apply manual decisions (merge/onsite)
  for (const [sKey, decision] of Object.entries(decisions)) {
    if (settlementMap.has(sKey)) {
      const entry = settlementMap.get(sKey);
      if (decision.mode) entry.mode = decision.mode;
      // Merged settlements are handled at the parent level
    }
  }
  
  // Group by parent
  const parentMap = new Map();
  for (const entry of settlementMap.values()) {
    const pKey = entry.parentKey;
    if (!parentMap.has(pKey)) {
      parentMap.set(pKey, {
        parentKey: pKey,
        parentName: entry.parentName,
        settlements: [],
      });
    }
    parentMap.get(pKey).settlements.push({
      key: entry.key,
      name: entry.name,
      persons: entry.persons.size,
      units: entry.units,
      mode: entry.mode,
      dates: Array.from(entry.dates).sort(),
      visits: entry.visits,
      stops: entry.stops,
    });
  }
  
  // Sort settlements within each parent by name
  for (const parent of parentMap.values()) {
    parent.settlements.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }
  
  // Convert to array and sort by parent name
  const parents = Array.from(parentMap.values()).sort((a, b) => 
    a.parentName.localeCompare(b.parentName, 'ru')
  );
  
  return { parents };
}

// Rebuild schedule with manual decisions applied
export async function rebuildScheduleWithDecisions(
  records,
  settings,
  calendar,
  targetYear,
  decisions,
  options = {},
) {
  // Apply decisions to settings by modifying the physical records' effective grouping
  // For now, we rebuild the physical schedule and then apply post-processing
  // based on decisions (merge/onsite)
  
  // GRAFIK-46: a failed chunk load must reach the UI as a retryable message
  // (ui.analyze renders the «Повторить» box), not as a silent rejection.
  let buildPhysicalSchedule;
  try {
    ({ buildPhysicalSchedule } = await import('./physical.js'));
  } catch (error) {
    if (error && typeof error === 'object') {
      error.importMessage = 'Не удалось загрузить модуль маршрутизации.';
    }
    throw error;
  }
  const physical = await buildPhysicalSchedule(records, settings, calendar, targetYear, options);
  
  // Apply merge decisions: combine settlements marked for merge
  // Apply onsite decisions: force settlements to onsite
  // This is a simplified approach - in reality we'd modify the algorithm
  // For the UI, we'll rebuild the visits array with merged/onsite applied
  
  // For merge: group settlements by mergeGroup key in decisions
  const mergeGroups = new Map();
  const onsiteForced = new Set();
  
  for (const [sKey, decision] of Object.entries(decisions)) {
    if (decision.mergeGroup) {
      if (!mergeGroups.has(decision.mergeGroup)) {
        mergeGroups.set(decision.mergeGroup, []);
      }
      mergeGroups.get(decision.mergeGroup).push(sKey);
    }
    if (decision.mode === 'площадка') {
      onsiteForced.add(sKey);
    }
  }
  
  // Rebuild outbound visits with merges applied
  const mergedOutbound = [];
  const mergedOnsite = [];
  
  // Track which settlements have been merged
  const mergedSettlements = new Set();
  
  // Process outbound visits
  for (const visit of physical.outboundVisits) {
    for (const stop of visit.stops || []) {
      const sKey = stop.key || stop.name;
      if (onsiteForced.has(sKey)) {
        // This settlement forced to onsite - will be handled in onsite pass
        continue;
      }
      if (mergedSettlements.has(sKey)) {
        // Already merged into another group
        continue;
      }
      
      // Check if this settlement is part of a merge group
      let foundGroup = null;
      for (const [groupKey, groupSettlements] of mergeGroups) {
        if (groupSettlements.includes(sKey)) {
          foundGroup = groupKey;
          break;
        }
      }
      
      if (foundGroup) {
        // Create merged visit for this group
        const groupStops = [];
        const groupRecords = [];
        const groupNames = [];
        const groupMunicipalities = new Set();
        let totalUnits = 0;
        let totalTravel = 0;
        let earliestDate = visit.date;
        let earliestStart = visit.startMin;
        
        for (const gKey of mergeGroups.get(foundGroup)) {
          mergedSettlements.add(gKey);
          // Find the visit/stop for this settlement
          for (const v of physical.outboundVisits) {
            for (const s of v.stops || []) {
              if ((s.key || s.name) === gKey) {
                groupStops.push(s);
                groupRecords.push(...(s.records || []));
                groupNames.push(s.name);
                if (s.municipality) groupMunicipalities.add(s.municipality);
                totalUnits += s.units || 0;
                totalTravel = Math.max(totalTravel, v.travelMinutes || 0);
                if (v.date < earliestDate) earliestDate = v.date;
                if (v.startMin < earliestStart) earliestStart = v.startMin;
                break;
              }
            }
          }
        }
        
        if (groupStops.length > 0) {
          mergedOutbound.push({
            ...visit,
            date: earliestDate,
            startMin: earliestStart,
            endMin: earliestStart + totalTravel + 60, // approximate
            stops: groupStops,
            totalUnits,
            travelMinutes: totalTravel,
            routeName: `${groupNames.join(', ')} (${Array.from(groupMunicipalities).join(', ') || '—'})`,
            isOutbound: true,
            isPhysical: true,
            merged: true,
            mergeGroup: foundGroup,
          });
        }
      } else {
        // Not merged, keep as is (unless forced onsite)
        if (!onsiteForced.has(sKey)) {
          mergedOutbound.push(visit);
        }
      }
    }
  }
  
  // Process onsite visits + forced onsite
  for (const visit of physical.onsiteVisits) {
    const newStops = [];
    for (const stop of visit.stops || []) {
      const sKey = stop.key || stop.name;
      if (!onsiteForced.has(sKey) && !mergedSettlements.has(sKey)) {
        newStops.push(stop);
      }
    }
    if (newStops.length > 0) {
      mergedOnsite.push({ ...visit, stops: newStops });
    }
  }
  
  // Add forced onsite settlements as new onsite visits
  for (const sKey of onsiteForced) {
    // Find the original outbound visit/stop
    for (const visit of physical.outboundVisits) {
      for (const stop of visit.stops || []) {
        if ((stop.key || stop.name) === sKey) {
          mergedOnsite.push({
            date: visit.date,
            startMin: visit.startMin,
            endMin: visit.endMin,
            stops: [stop],
            totalUnits: stop.units || 0,
            travelMinutes: 0,
            isOutbound: false,
            isPhysical: true,
            location: 'inspection',
            address: '',
            forcedOnsite: true,
          });
          break;
        }
      }
    }
  }
  
  return { outboundVisits: mergedOutbound, onsiteVisits: mergedOnsite, notes: physical.notes };
}

// Render the physical tab tree UI
export function renderPhysicalTab(root, tree, onSelectionChange, onAction, selectedSettlements = new Set()) {
  const container = root.getElementById('physical-tab-content');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (!tree.parents || tree.parents.length === 0) {
    container.appendChild(createElement('p', 'placeholder', 'Нет данных физлиц для отображения. Проверьте настройки и загрузите файл.'));
    return;
  }
  
  const treeWrapper = createElement('div', 'physical-tree');
  treeWrapper.setAttribute('role', 'tree');
  treeWrapper.setAttribute('aria-label', 'Поселения физлиц');
  
  for (const parent of tree.parents) {
    const parentNode = createElement('div', 'physical-tree-parent');
    parentNode.setAttribute('role', 'treeitem');
    parentNode.setAttribute('aria-expanded', 'true');
    
    const parentHeader = createElement('div', 'physical-tree-parent-header');
    parentHeader.setAttribute('role', 'button');
    parentHeader.setAttribute('tabindex', '0');
    parentHeader.setAttribute('aria-expanded', 'true');
    parentHeader.innerHTML = `
      <span class="tree-toggle" aria-hidden="true">▼</span>
      <span class="tree-label">${escapeHtml(parent.parentName)}</span>
      <span class="tree-summary">${parent.settlements.length} насел. пункт(а/ов), ${parent.settlements.reduce((s, c) => s + c.units, 0)} ед.</span>
    `;
    
    parentHeader.addEventListener('click', () => {
      const expanded = parentHeader.getAttribute('aria-expanded') === 'true';
      parentHeader.setAttribute('aria-expanded', String(!expanded));
      settlementsList.hidden = expanded;
      parentHeader.querySelector('.tree-toggle').textContent = expanded ? '▶' : '▼';
    });
    parentHeader.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        parentHeader.click();
      }
    });
    
    const settlementsList = createElement('div', 'physical-tree-settlements');
    settlementsList.setAttribute('role', 'group');
    
    for (const settlement of parent.settlements) {
      const settlementNode = createElement('div', 'physical-tree-settlement');
      settlementNode.setAttribute('role', 'treeitem');
      settlementNode.dataset.settlementKey = settlement.key;
      
      const isSelected = selectedSettlements.has(settlement.key);
      if (isSelected) settlementNode.classList.add('selected');
      
      const modeClass = settlement.mode === 'площадка' ? 'mode-onsite' : 'mode-outbound';
      const modeLabel = settlement.mode === 'площадка' ? '🏢 Площадка' : '🚐 Выезд';
      
      settlementNode.innerHTML = `
        <label class="settlement-row">
          <input type="checkbox" class="settlement-checkbox" ${isSelected ? 'checked' : ''} aria-label="Выбрать ${escapeHtml(settlement.name)}" />
          <span class="settlement-name">${escapeHtml(settlement.name)}</span>
          <span class="settlement-stats">${settlement.persons} чел., ${settlement.units} ед.</span>
          <span class="settlement-mode ${modeClass}">${modeLabel}</span>
          <span class="settlement-dates">${settlement.dates.join(', ') || '—'}</span>
        </label>
      `;
      
      const checkbox = settlementNode.querySelector('.settlement-checkbox');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedSettlements.add(settlement.key);
          settlementNode.classList.add('selected');
        } else {
          selectedSettlements.delete(settlement.key);
          settlementNode.classList.remove('selected');
        }
        onSelectionChange(selectedSettlements);
      });
      
      // Double-click to toggle mode
      settlementNode.addEventListener('dblclick', () => {
        const newMode = settlement.mode === 'выезд' ? 'площадка' : 'выезд';
        onAction('toggleMode', { settlementKey: settlement.key, newMode });
      });
      
      settlementsList.appendChild(settlementNode);
    }
    
    parentNode.appendChild(parentHeader);
    parentNode.appendChild(settlementsList);
    treeWrapper.appendChild(parentNode);
  }
  
  container.appendChild(treeWrapper);
  
  // Action buttons
  const actionsDiv = createElement('div', 'physical-actions');
  actionsDiv.innerHTML = `
    <button type="button" class="button button-primary" id="action-merge" disabled aria-describedby="merge-desc">
      Объединить в один выезд
    </button>
    <button type="button" class="button" id="action-split" disabled aria-describedby="split-desc">
      Разделить
    </button>
    <button type="button" class="button" id="action-onsite" disabled aria-describedby="onsite-desc">
      На площадку
    </button>
    <button type="button" class="button button-secondary" id="action-reset" disabled aria-describedby="reset-desc">
      Сбросить ручные изменения
    </button>
    <div id="merge-desc" class="sr-only">Объединяет выбранные поселения в один выездный маршрут</div>
    <div id="split-desc" class="sr-only">Разделяет объединённый выезд на отдельные поселения</div>
    <div id="onsite-desc" class="sr-only">Принудительно переводит выбранные поселения на площадку</div>
    <div id="reset-desc" class="sr-only">Сбрасывает все ручные изменения для текущей выгрузки</div>
  `;
  
  const mergeBtn = actionsDiv.querySelector('#action-merge');
  const splitBtn = actionsDiv.querySelector('#action-split');
  const onsiteBtn = actionsDiv.querySelector('#action-onsite');
  const resetBtn = actionsDiv.querySelector('#action-reset');
  
  function updateActionButtons() {
    const count = selectedSettlements.size;
    const hasMerged = tree.parents.some(p => p.settlements.some(s => s.merged || s.mergeGroup));
    
    mergeBtn.disabled = count < 2;
    splitBtn.disabled = count === 0 || !hasMerged;
    onsiteBtn.disabled = count === 0;
    resetBtn.disabled = !hasAnyDecisions();
  }
  
  function hasAnyDecisions() {
    // Check if there are any manual decisions stored
    return false; // Will be implemented with decisions state
  }
  
  mergeBtn.addEventListener('click', () => onAction('merge', { settlementKeys: Array.from(selectedSettlements) }));
  splitBtn.addEventListener('click', () => onAction('split', { settlementKeys: Array.from(selectedSettlements) }));
  onsiteBtn.addEventListener('click', () => onAction('forceOnsite', { settlementKeys: Array.from(selectedSettlements) }));
  resetBtn.addEventListener('click', () => onAction('reset', {}));
  
  container.appendChild(actionsDiv);
  
  // Initial button state
  updateActionButtons();
  
  // Return function to update buttons when selection changes
  return { updateActionButtons };
}

function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}