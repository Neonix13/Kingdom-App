// Field specs and validation of the balance tables. The specs are served to the admin UI (GET /api/balance/schema)
// so that inline validation in the browser and validation on save use the same rules.

const ID_PATTERN = '^[a-z][a-z0-9_]*$';
const KINGDOMS = ['QIN', 'ZHAO', 'WEI', 'CHU', 'HAN', 'YAN', 'QI'];
const KINGDOM_PATTERN = `^(${KINGDOMS.join('|')})(/(${KINGDOMS.join('|')}))*$`;

const int = (key, label, min, max, extra = {}) => ({ key, label, type: 'int', min, max, ...extra });
const str = (key, label, minLength, maxLength, extra = {}) => ({ key, label, type: 'string', minLength, maxLength, ...extra });
const bool = (key, label, extra = {}) => ({ key, label, type: 'bool', ...extra });

const MOD = { min: -10, max: 10 };
const modifier = (key, label, group) => int(key, label, MOD.min, MOD.max, { group });

const COMBAT_MODIFIERS = [
  modifier('vitesse', 'Vitesse', 'Mouvement'),
  modifier('attack_cac', 'Attaque CàC', 'Attaque'),
  modifier('attack_tir', 'Attaque tir', 'Attaque'),
  modifier('defense_cac', 'Défense CàC', 'Défense'),
  modifier('defense_tir', 'Défense tir', 'Défense'),
  modifier('puissance_cac', 'Puissance CàC', 'Puissance'),
  modifier('puissance_tir', 'Puissance tir', 'Puissance'),
  modifier('intimidation_cac', 'Intimidation CàC', 'Intimidation'),
  modifier('intimidation_tir', 'Intimidation tir', 'Intimidation'),
  modifier('courage_cac', 'Courage CàC', 'Courage'),
  modifier('courage_tir', 'Courage tir', 'Courage'),
  modifier('esquive_cac', 'Esquive CàC', 'Esquive'),
  modifier('esquive_tir', 'Esquive tir', 'Esquive'),
  modifier('precision_cac', 'Précision CàC', 'Précision'),
  modifier('precision_tir', 'Précision tir', 'Précision'),
  modifier('armure', 'Armure', 'Armure / tour'),
  modifier('armure_tour', 'Armure / tour', 'Armure / tour'),
  modifier('moral_tour', 'Moral / tour', 'Armure / tour'),
  modifier('vitalite_tour', 'Vitalité / tour', 'Armure / tour'),
];

const SPEC = {
  units: {
    label: 'Unités',
    shape: 'map',
    fields: [
      str('id', 'Identifiant', 1, 40, { pattern: ID_PATTERN, readOnly: true }),
      str('name', 'Nom', 1, 60),
      { key: 'category', label: 'Catégorie', type: 'enum', options: ['Infanterie', 'Chevaux', 'Tireurs', 'Chars'] },
      int('vitality', 'Vitalité', 1, 2000, { group: 'Vitalité' }),
      int('maxVitality', 'Vitalité max', 1, 2000, { group: 'Vitalité' }),
      int('morale', 'Moral', 1, 2000, { group: 'Moral' }),
      int('maxMorale', 'Moral max', 1, 2000, { group: 'Moral' }),
      int('attack', 'Attaque', 0, 40),
      int('power', 'Puissance', 0, 100),
      int('defense', 'Défense', 0, 40),
      int('armor', 'Armure', 0, 100),
      int('intimidation', 'Intimidation', 0, 30),
      int('speed', 'Vitesse', 1, 12),
      int('range', 'Portée', 1, 10, { hint: 'en cases (1 = corps à corps)' }),
      int('cost', 'Coût', 50, 10000, { hint: 'or ; minimum 50 (le constructeur d\'armée de l\'IA boucle sur le coût)' }),
      str('bonus', 'Bonus (texte)', 0, 400, { multiline: true }),
      str('bonusType', 'Type de bonus', 1, 40, { pattern: ID_PATTERN, optional: true }),
      int('bonusValue', 'Valeur du bonus', 0, 100, { optional: true, group: 'Capacité', hint: 'moral/tour (piétaille), % de vitalité (soldats), +puissance (lanciers), +vitesse (cav. légère), % du moral infligé aux voisins (cav. lourde)' }),
      int('bonusRange', 'Portée du bonus', 0, 20, { optional: true, group: 'Capacité', hint: 'en cases : aucun ennemi à moins de (assassin)' }),
      int('bonusCost', 'Coût de la capacité', 0, 12, { optional: true, group: 'Capacité', hint: 'vitesse dépensée (espion, assassin, bâtisseurs)' }),
    ],
    rules: [
      { type: 'lte', a: 'vitality', b: 'maxVitality', message: 'La vitalité ne peut pas dépasser la vitalité max.' },
      { type: 'lte', a: 'morale', b: 'maxMorale', message: 'Le moral ne peut pas dépasser le moral max.' },
    ],
  },
  generals: {
    label: 'Généraux',
    shape: 'list',
    fields: [
      str('id', 'Identifiant', 1, 40, { pattern: ID_PATTERN, readOnly: true }),
      str('name', 'Nom', 1, 60),
      str('kingdom', 'Royaume', 2, 40, { pattern: KINGDOM_PATTERN, options: [...KINGDOMS, 'ZHAO/WEI'], hint: 'QIN, ZHAO, WEI, CHU, HAN, YAN, QI ou combinaison avec /' }),
      int('vitality', 'Vitalité', 1, 500, { group: 'Vitalité' }),
      int('maxVitality', 'Vitalité max', 1, 500, { group: 'Vitalité' }),
      int('power', 'Puissance', 0, 100, { hint: 'attaque du général : (Force − d20 + 80) × Puissance / 5 × ratio d\'armure / 2' }),
      int('armor', 'Armure', 0, 60),
      int('intimidation', 'Intimidation', 0, 30, { hint: 'moral infligé : (Charisme − d20 + 80) × Intimidation / 100' }),
      int('force', 'Force', 1, 30, { hint: 'attaque et défense du général' }),
      int('strategy', 'Stratégie', 1, 30, { hint: 'portée de vision (cases) et initiative' }),
      int('charisma', 'Charisme', 1, 30, { hint: 'moral infligé, motivation, rayon de la piétaille (Charisme / 5)' }),
      str('citation', 'Citation', 0, 400, { multiline: true }),
      {
        key: 'activeAbility', label: 'Capacité active', type: 'object', optional: true,
        fields: [str('name', 'Nom', 1, 60), str('description', 'Description', 0, 400, { multiline: true, optional: true }), int('cooldown', 'Recharge (tours)', 0, 20)],
      },
      {
        key: 'passiveAbility', label: 'Capacité passive', type: 'object', optional: true,
        fields: [str('name', 'Nom', 1, 60), str('description', 'Description', 0, 400, { multiline: true, optional: true })],
      },
    ],
    rules: [
      { type: 'lte', a: 'vitality', b: 'maxVitality', message: 'La vitalité ne peut pas dépasser la vitalité max.' },
    ],
  },
  terrains: {
    label: 'Terrains',
    shape: 'map',
    fields: [
      str('id', 'Identifiant', 1, 40, { pattern: ID_PATTERN, readOnly: true }),
      str('name', 'Nom', 1, 60),
      // no speed modifier: terrain is paid step by step (movement cost on entering the hex), not on the turn speed
      ...COMBAT_MODIFIERS.filter(m => m.key !== 'vitesse'),
    ],
  },
  segments: {
    label: 'Segments',
    shape: 'map',
    fields: [
      str('id', 'Identifiant', 1, 40, { pattern: ID_PATTERN, readOnly: true }),
      str('name', 'Nom', 1, 60),
      ...COMBAT_MODIFIERS.slice(0, 7),
      modifier('intimidation_cac', 'Intimidation CàC', 'Intimidation'),
      modifier('intimidation_tir', 'Intimidation tir', 'Intimidation'),
      modifier('armure_cac', 'Armure attaquant CàC', 'Armure'),
      modifier('armure_tir', 'Armure attaquant tir', 'Armure'),
      modifier('defense_puissance_cac', 'Puissance défenseur CàC', 'Défenseur'),
      modifier('defense_puissance_tir', 'Puissance défenseur tir', 'Défenseur'),
      modifier('defense_intimidation_cac', 'Intimidation défenseur CàC', 'Défenseur'),
      modifier('defense_intimidation_tir', 'Intimidation défenseur tir', 'Défenseur'),
      modifier('defense_armure_cac', 'Armure défenseur CàC', 'Défenseur'),
      modifier('defense_armure_tir', 'Armure défenseur tir', 'Défenseur'),
      bool('vitesse_tout', 'Vitesse (tout)'),
      int('vitesse_fixe', 'Coût fixe', 0, 10, { optional: true, hint: 'coût exact en vitesse pour traverser (vide = coût normal)' }),
      bool('infranchissable', 'Infranchissable'),
      bool('infranchissable_cavalerie', 'Infranch. cavalerie'),
      { key: 'special', label: 'Spécial', type: 'enum', options: ['collapse_1d4'], nullable: true, hint: 'collapse_1d4 : 1 chance sur 4 de perdre autant de vitalité que son armure' },
      int('puissance_vs_cavalry', 'Puiss. vs cavalerie', -10, 20, { optional: true }),
    ],
  },
  stances: {
    label: 'Postures',
    shape: 'map',
    fields: [
      str('id', 'Identifiant', 1, 40, { pattern: ID_PATTERN, readOnly: true }),
      str('name', 'Nom', 1, 60),
      str('icon', 'Icône', 1, 80, { pattern: '^/icons/[A-Za-z0-9_.-]+\\.svg$' }),
      ...COMBAT_MODIFIERS,
    ],
  },
};

const TABLES = Object.keys(SPEC);

function checkField(f, v, path, errors) {
  const absent = v === undefined;
  if (absent) {
    if (!f.optional) errors.push({ field: path, message: `${f.label} : champ requis.` });
    return;
  }
  if (v === null) {
    if (!f.nullable) errors.push({ field: path, message: `${f.label} : valeur requise.` });
    return;
  }
  switch (f.type) {
    case 'int':
      if (typeof v !== 'number' || !Number.isInteger(v)) errors.push({ field: path, message: `${f.label} : nombre entier attendu.` });
      else if (v < f.min || v > f.max) errors.push({ field: path, message: `${f.label} : doit être entre ${f.min} et ${f.max}.` });
      break;
    case 'string':
      if (typeof v !== 'string') { errors.push({ field: path, message: `${f.label} : texte attendu.` }); break; }
      if (v.length < (f.minLength || 0)) errors.push({ field: path, message: `${f.label} : requis.` });
      else if (v.length > f.maxLength) errors.push({ field: path, message: `${f.label} : ${f.maxLength} caractères maximum.` });
      else if (f.pattern && !new RegExp(f.pattern).test(v)) errors.push({ field: path, message: `${f.label} : format invalide${f.hint ? ` (${f.hint})` : ''}.` });
      break;
    case 'bool':
      if (typeof v !== 'boolean') errors.push({ field: path, message: `${f.label} : vrai/faux attendu.` });
      break;
    case 'enum':
      if (!f.options.includes(v)) errors.push({ field: path, message: `${f.label} : valeur inconnue « ${v} » (${f.options.join(', ')}).` });
      break;
    case 'object':
      if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push({ field: path, message: `${f.label} : objet attendu.` }); break; }
      checkObject(f.fields, v, path, errors);
      break;
    default:
      errors.push({ field: path, message: `${f.label} : type inconnu.` });
  }
}

function checkObject(fields, obj, prefix, errors) {
  const known = new Set(fields.map((f) => f.key));
  for (const k of Object.keys(obj)) {
    if (!known.has(k)) errors.push({ field: prefix ? `${prefix}.${k}` : k, message: `Champ inconnu « ${k} ».` });
  }
  for (const f of fields) checkField(f, obj[f.key], prefix ? `${prefix}.${f.key}` : f.key, errors);
}

function entriesOf(table, data) {
  const spec = SPEC[table];
  if (spec.shape === 'list') {
    if (!Array.isArray(data)) return null;
    return data.map((e, i) => [e && typeof e === 'object' ? e.id : undefined, e, i]);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return Object.entries(data).map(([k, e]) => [k, e, k]);
}

// Validates a whole table. `currentIds` (ids of the saved version) freezes the set of entries:
// ids are referenced by maps, the engine, the AI and the client, so entries can be edited but not added or removed.
function validateTable(table, data, currentIds) {
  const spec = SPEC[table];
  if (!spec) return [{ message: `Table inconnue « ${table} ».` }];
  const errors = [];
  const entries = entriesOf(table, data);
  if (!entries) return [{ message: spec.shape === 'list' ? 'Tableau attendu.' : 'Objet attendu (clé = identifiant).' }];
  const seen = new Set();
  for (const [key, entry, pos] of entries) {
    const id = entry && typeof entry === 'object' ? entry.id : undefined;
    const errs = [];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push({ id: String(key ?? pos), message: 'Entrée invalide (objet attendu).' });
      continue;
    }
    checkObject(spec.fields, entry, '', errs);
    if (spec.shape === 'map' && key !== id) errs.push({ field: 'id', message: `L'identifiant « ${id} » doit être égal à la clé « ${key} ».` });
    if (typeof id === 'string') {
      if (seen.has(id)) errs.push({ field: 'id', message: `Identifiant en double « ${id} ».` });
      seen.add(id);
    }
    for (const r of spec.rules || []) {
      if (r.type === 'lte' && Number.isInteger(entry[r.a]) && Number.isInteger(entry[r.b]) && entry[r.a] > entry[r.b]) {
        errs.push({ field: r.a, message: r.message });
      }
    }
    for (const e of errs) errors.push({ id: String(id ?? key ?? pos), ...e });
  }
  if (currentIds) {
    const ids = new Set(entries.map(([, e]) => e && e.id));
    for (const id of currentIds) if (!ids.has(id)) errors.push({ id, message: `Entrée « ${id} » manquante : la suppression d'entrées n'est pas prise en charge.` });
    for (const id of ids) if (typeof id === 'string' && !currentIds.includes(id)) errors.push({ id, message: `Entrée « ${id} » inconnue : l'ajout d'entrées n'est pas pris en charge depuis l'éditeur.` });
  }
  return errors;
}

function idsOf(table, data) {
  const entries = entriesOf(table, data) || [];
  return entries.map(([, e]) => e && e.id).filter((id) => typeof id === 'string');
}

module.exports = { SPEC, TABLES, KINGDOMS, validateTable, idsOf };
