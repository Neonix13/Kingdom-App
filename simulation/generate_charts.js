// Génère tous les graphiques de balance à partir de viz_data.json
// Output : simulation/charts/*.png
// Usage : node simulation/generate_charts.js

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const fs = require('fs');
const path = require('path');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'results/viz_data.json'), 'utf8'));
const OUT = path.join(__dirname, 'charts');

const KINGDOM_COLORS = { QIN: '#e05c2a', ZHAO: '#3a7bd5', 'ZHAO/WEI': '#9b59b6', WEI: '#27ae60' };
const CATEGORY_COLORS = { Infanterie: '#3a7bd5', Chevaux: '#e05c2a', Tireurs: '#27ae60', Chars: '#8e44ad' };

// Données généraux enrichies de leur royaume
const KINGDOMS = {
  ou_ki: 'QIN', mou_bu: 'QIN', ou_sen: 'QIN', kan_ki: 'QIN',
  ri_boku: 'ZHAO', kei_sha: 'ZHAO', shi_ba_shou: 'ZHAO',
  ren_pa: 'ZHAO/WEI',
  go_kei: 'WEI', go_hou_mei: 'WEI', gai_mou: 'WEI'
};
const GENERAL_STATS = {
  ou_ki:       { force: 15, strategie: 16 },
  mou_bu:      { force: 18, strategie: 12 },
  ou_sen:      { force: 13, strategie: 17 },
  kan_ki:      { force: 14, strategie: 16 },
  ri_boku:     { force: 11, strategie: 18 },
  kei_sha:     { force: 13, strategie: 16 },
  shi_ba_shou: { force: 17, strategie: 15 },
  ren_pa:      { force: 17, strategie: 16 },
  go_kei:      { force: 14, strategie: 17 },
  go_hou_mei:  { force: 10, strategie: 18 },
  gai_mou:     { force: 18, strategie: 12 },
};

async function save(canvas, filename) {
  const buf = await canvas.renderToBuffer(canvas._chart);
  // renderToBuffer needs a config — use renderToBuffer(config) directly
}

async function chart(filename, width, height, config) {
  const c = new ChartJSNodeCanvas({ width, height, backgroundColour: '#1a1a2e' });
  const buf = await c.renderToBuffer(config);
  fs.writeFileSync(path.join(OUT, filename), buf);
  console.log(`  ✓ ${filename}`);
}

async function main() {
  console.log('Génération des graphiques...\n');

  // ── 1. Barplot taux de victoire généraux ──────────────────────────────
  {
    const sorted = [...DATA.generals].sort((a, b) => b.winRate - a.winRate);
    await chart('1_generals_winrate.png', 900, 500, {
      type: 'bar',
      data: {
        labels: sorted.map(g => g.name),
        datasets: [{
          label: 'Taux de victoire (%)',
          data: sorted.map(g => g.winRate),
          backgroundColor: sorted.map(g => KINGDOM_COLORS[KINGDOMS[g.id]] + 'cc'),
          borderColor: sorted.map(g => KINGDOM_COLORS[KINGDOMS[g.id]]),
          borderWidth: 2,
          errorBars: sorted.reduce((acc, g) => { acc[g.name] = { plus: g.ci95, minus: g.ci95 }; return acc; }, {}),
        }]
      },
      options: {
        indexAxis: 'y',
        plugins: {
          title: { display: true, text: 'Taux de victoire par général (budget 10 000)', color: '#e0e0e0', font: { size: 16 } },
          legend: { display: false },
          annotation: {
            annotations: {
              line50: { type: 'line', xMin: 50, xMax: 50, borderColor: '#ffffff55', borderWidth: 1, borderDash: [6, 4] }
            }
          }
        },
        scales: {
          x: {
            min: 20, max: 75,
            ticks: { color: '#aaa', callback: v => v + '%' },
            grid: { color: '#333' },
            title: { display: true, text: 'Winrate (%)', color: '#aaa' }
          },
          y: { ticks: { color: '#ddd', font: { size: 13 } }, grid: { color: '#2a2a3e' } }
        }
      }
    });
  }

  // ── 2. Heatmap matchup matrix — dessin canvas manuel ─────────────────
  {
    const { createCanvas } = require('canvas');
    const ids = DATA.generalIds;
    const names = DATA.generalNames;
    const n = ids.length;

    const MARGIN_LEFT = 120;
    const MARGIN_TOP = 90;
    const CELL = 58;
    const W = MARGIN_LEFT + n * CELL + 20;
    const H = MARGIN_TOP + n * CELL + 20;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Fond
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    // Titre
    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Matrice de matchup — % victoire (ligne vs colonne)', W / 2, 28);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText('Rouge = ligne gagne souvent   Bleu = colonne gagne souvent', W / 2, 50);

    // Noms colonnes (en diagonale)
    ctx.fillStyle = '#ddd';
    ctx.font = 'bold 12px sans-serif';
    for (let c = 0; c < n; c++) {
      const x = MARGIN_LEFT + c * CELL + CELL / 2;
      const y = MARGIN_TOP - 8;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'left';
      ctx.fillText(names[c], 0, 0);
      ctx.restore();
    }

    // Noms lignes
    ctx.textAlign = 'right';
    for (let r = 0; r < n; r++) {
      const y = MARGIN_TOP + r * CELL + CELL / 2 + 5;
      ctx.fillStyle = '#ddd';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(names[r], MARGIN_LEFT - 8, y);
    }

    // Cellules
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const x = MARGIN_LEFT + c * CELL;
        const y = MARGIN_TOP + r * CELL;
        const val = DATA.matrix[r][c];

        if (val === null || r === c) {
          // Diagonale
          ctx.fillStyle = '#2a2a3e';
          ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
          ctx.fillStyle = '#555';
          ctx.font = '14px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('—', x + CELL / 2, y + CELL / 2 + 5);
          continue;
        }

        // Couleur : rouge si val > 50, bleu si val < 50
        const norm = (val - 20) / 60; // 0 à 1 pour val 20→80
        let red, green, blue;
        if (norm > 0.5) {
          // rouge dominant
          const t = (norm - 0.5) * 2;
          red = Math.round(180 + 60 * t);
          green = Math.round(60 - 50 * t);
          blue = Math.round(60 - 50 * t);
        } else {
          // bleu dominant
          const t = (0.5 - norm) * 2;
          red = Math.round(60 - 40 * t);
          green = Math.round(60 - 40 * t);
          blue = Math.round(160 + 60 * t);
        }

        ctx.fillStyle = `rgb(${red},${green},${blue})`;
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);

        // Valeur
        const textColor = (norm > 0.65 || norm < 0.35) ? '#fff' : '#111';
        ctx.fillStyle = textColor;
        ctx.font = `bold ${val === 100 ? 12 : 14}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(val + '%', x + CELL / 2, y + CELL / 2 + 5);
      }
    }

    // Bordures grille
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2;
    for (let r = 0; r <= n; r++) {
      ctx.beginPath();
      ctx.moveTo(MARGIN_LEFT, MARGIN_TOP + r * CELL);
      ctx.lineTo(MARGIN_LEFT + n * CELL, MARGIN_TOP + r * CELL);
      ctx.stroke();
    }
    for (let c = 0; c <= n; c++) {
      ctx.beginPath();
      ctx.moveTo(MARGIN_LEFT + c * CELL, MARGIN_TOP);
      ctx.lineTo(MARGIN_LEFT + c * CELL, MARGIN_TOP + n * CELL);
      ctx.stroke();
    }

    // Légende
    const legY = H - 14;
    const gradient = ctx.createLinearGradient(MARGIN_LEFT, 0, MARGIN_LEFT + n * CELL, 0);
    gradient.addColorStop(0, 'rgb(60,60,220)');
    gradient.addColorStop(0.5, 'rgb(120,120,120)');
    gradient.addColorStop(1, 'rgb(240,60,60)');
    ctx.fillStyle = gradient;
    ctx.fillRect(MARGIN_LEFT, legY - 10, n * CELL, 10);
    ctx.fillStyle = '#aaa';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('20%', MARGIN_LEFT, legY + 12);
    ctx.textAlign = 'center';
    ctx.fillText('50%', MARGIN_LEFT + n * CELL / 2, legY + 12);
    ctx.textAlign = 'right';
    ctx.fillText('80%', MARGIN_LEFT + n * CELL, legY + 12);

    fs.writeFileSync(path.join(OUT, '2_matchup_matrix.png'), canvas.toBuffer('image/png'));
    console.log('  ✓ 2_matchup_matrix.png');
  }

  // ── 3. Scatter Force vs Stratégie → winrate ───────────────────────────
  {
    const gens = DATA.generals.map(g => ({
      ...g,
      force: GENERAL_STATS[g.id]?.force || 0,
      strategie: GENERAL_STATS[g.id]?.strategie || 0,
      kingdom: KINGDOMS[g.id]
    }));
    const datasets = Object.entries(KINGDOM_COLORS).map(([k, color]) => ({
      label: k,
      data: gens.filter(g => g.kingdom === k).map(g => ({ x: g.force, y: g.strategie, r: Math.max(6, (g.winRate - 20) / 2), name: g.name, wr: g.winRate })),
      backgroundColor: color + '99',
      borderColor: color,
      borderWidth: 2,
    }));
    await chart('3_force_vs_strategie.png', 700, 500, {
      type: 'bubble',
      data: { datasets },
      options: {
        plugins: {
          title: { display: true, text: 'Force vs Stratégie — taille bulle = winrate', color: '#e0e0e0', font: { size: 15 } },
          legend: { labels: { color: '#ddd' } },
          tooltip: { callbacks: { label: ctx => `${ctx.raw.name} — ${ctx.raw.wr}%` } }
        },
        scales: {
          x: { min: 8, max: 20, ticks: { color: '#aaa' }, grid: { color: '#333' }, title: { display: true, text: 'Force', color: '#aaa' } },
          y: { min: 10, max: 20, ticks: { color: '#aaa' }, grid: { color: '#333' }, title: { display: true, text: 'Stratégie', color: '#aaa' } }
        }
      }
    });
  }

  // ── 4. Barplot survie des unités ──────────────────────────────────────
  {
    const sorted = [...DATA.units].sort((a, b) => b.survivalRate - a.survivalRate);
    const UNIT_CATEGORIES = {
      pietaille:'Infanterie', soldats:'Infanterie', phalange:'Infanterie',
      lancier:'Infanterie', espion:'Infanterie', assassin:'Infanterie',
      cavalier_leger:'Chevaux', cavalier_lourd:'Chevaux',
      archer:'Tireurs', archer_elite:'Tireurs',
      batisseurs:'Chars', char:'Chars'
    };
    await chart('4_unit_survival.png', 900, 500, {
      type: 'bar',
      data: {
        labels: sorted.map(u => u.name),
        datasets: [{
          label: 'Taux de survie (%)',
          data: sorted.map(u => u.survivalRate),
          backgroundColor: sorted.map(u => (CATEGORY_COLORS[UNIT_CATEGORIES[u.id]] || '#888') + 'cc'),
          borderColor: sorted.map(u => CATEGORY_COLORS[UNIT_CATEGORIES[u.id]] || '#888'),
          borderWidth: 2,
        }]
      },
      options: {
        indexAxis: 'y',
        plugins: {
          title: { display: true, text: 'Taux de survie par unité (budget 10 000)', color: '#e0e0e0', font: { size: 15 } },
          legend: { display: false },
        },
        scales: {
          x: { min: 0, max: 105, ticks: { color: '#aaa', callback: v => v + '%' }, grid: { color: '#333' } },
          y: { ticks: { color: '#ddd', font: { size: 12 } }, grid: { color: '#2a2a3e' } }
        }
      }
    });
  }

  // ── 5. Scatter dmg infligés vs reçus ─────────────────────────────────
  {
    const UNIT_CATEGORIES = {
      pietaille:'Infanterie', soldats:'Infanterie', phalange:'Infanterie',
      lancier:'Infanterie', espion:'Infanterie', assassin:'Infanterie',
      cavalier_leger:'Chevaux', cavalier_lourd:'Chevaux',
      archer:'Tireurs', archer_elite:'Tireurs',
      batisseurs:'Chars', char:'Chars'
    };
    const datasets = Object.entries(CATEGORY_COLORS).map(([cat, color]) => ({
      label: cat,
      data: DATA.units.filter(u => UNIT_CATEGORIES[u.id] === cat).map(u => ({
        x: u.avgDamageTaken, y: u.avgDamageDealt,
        r: Math.max(6, u.survivalRate / 8),
        name: u.name, surv: u.survivalRate
      })),
      backgroundColor: color + '99',
      borderColor: color,
      borderWidth: 2,
    }));
    await chart('5_dmg_dealt_vs_taken.png', 700, 550, {
      type: 'bubble',
      data: { datasets },
      options: {
        plugins: {
          title: { display: true, text: 'Dégâts infligés vs reçus — taille bulle = survie', color: '#e0e0e0', font: { size: 14 } },
          legend: { labels: { color: '#ddd' } },
          tooltip: { callbacks: { label: ctx => `${ctx.raw.name} — survie ${ctx.raw.surv}%` } }
        },
        scales: {
          x: { ticks: { color: '#aaa' }, grid: { color: '#333' }, title: { display: true, text: 'Dmg reçus/unité', color: '#aaa' } },
          y: { ticks: { color: '#aaa' }, grid: { color: '#333' }, title: { display: true, text: 'Dmg infligés/unité', color: '#aaa' } }
        }
      }
    });
  }

  // ── 6. Radar chart par unité ──────────────────────────────────────────
  {
    const UNIT_STATS_RAW = require('../game/data/units');
    const unitList = Object.values(UNIT_STATS_RAW);
    const maxVals = { attack: 18, power: 16, defense: 11, armor: 80, vitality: 300 };
    const COLORS = ['#e05c2a','#3a7bd5','#27ae60','#f1c40f','#9b59b6','#1abc9c','#e74c3c','#2ecc71','#3498db','#e67e22','#95a5a6','#d35400'];

    await chart('6_unit_radar.png', 900, 700, {
      type: 'radar',
      data: {
        labels: ['Attaque', 'Puissance', 'Défense', 'Armure', 'Vitalité'],
        datasets: unitList.map((u, i) => ({
          label: u.name,
          data: [
            u.attack / maxVals.attack * 100,
            u.power / maxVals.power * 100,
            u.defense / maxVals.defense * 100,
            u.armor / maxVals.armor * 100,
            u.vitality / maxVals.vitality * 100,
          ],
          borderColor: COLORS[i % COLORS.length],
          backgroundColor: COLORS[i % COLORS.length] + '22',
          borderWidth: 2,
          pointRadius: 3,
        }))
      },
      options: {
        plugins: {
          title: { display: true, text: 'Profil des unités — stats normalisées', color: '#e0e0e0', font: { size: 15 } },
          legend: { labels: { color: '#ccc', font: { size: 10 } } }
        },
        scales: {
          r: {
            min: 0, max: 100,
            ticks: { color: '#aaa', backdropColor: 'transparent', stepSize: 25 },
            grid: { color: '#444' },
            pointLabels: { color: '#ddd', font: { size: 12 } },
            angleLines: { color: '#555' }
          }
        }
      }
    });
  }

  // ── 7. Scatter coût vs survie (value for money) ───────────────────────
  {
    const UNIT_CATEGORIES = {
      pietaille:'Infanterie', soldats:'Infanterie', phalange:'Infanterie',
      lancier:'Infanterie', espion:'Infanterie', assassin:'Infanterie',
      cavalier_leger:'Chevaux', cavalier_lourd:'Chevaux',
      archer:'Tireurs', archer_elite:'Tireurs',
      batisseurs:'Chars', char:'Chars'
    };
    const datasets = Object.entries(CATEGORY_COLORS).map(([cat, color]) => ({
      label: cat,
      data: DATA.units.filter(u => UNIT_CATEGORIES[u.id] === cat).map(u => ({
        x: u.cost, y: u.survivalRate,
        r: Math.max(6, u.avgDamageDealt / 5),
        name: u.name
      })),
      backgroundColor: color + '99',
      borderColor: color,
      borderWidth: 2,
    }));
    await chart('7_cost_vs_survival.png', 700, 500, {
      type: 'bubble',
      data: { datasets },
      options: {
        plugins: {
          title: { display: true, text: 'Coût vs Survie — taille bulle = dmg infligés', color: '#e0e0e0', font: { size: 14 } },
          legend: { labels: { color: '#ddd' } },
          tooltip: { callbacks: { label: ctx => `${ctx.raw.name}` } }
        },
        scales: {
          x: { ticks: { color: '#aaa' }, grid: { color: '#333' }, title: { display: true, text: 'Coût (or)', color: '#aaa' } },
          y: { min: 0, max: 105, ticks: { color: '#aaa', callback: v => v + '%' }, grid: { color: '#333' }, title: { display: true, text: 'Survie (%)', color: '#aaa' } }
        }
      }
    });
  }

  // ── 8. Composition winner vs loser ────────────────────────────────────
  {
    const sorted = [...DATA.compWinner].sort((a, b) => (b.avgWinner - b.avgLoser) - (a.avgWinner - a.avgLoser));
    await chart('8_army_composition.png', 900, 500, {
      type: 'bar',
      data: {
        labels: sorted.map(u => u.unitName),
        datasets: [
          {
            label: 'Armée gagnante (moy. unités)',
            data: sorted.map(u => u.avgWinner),
            backgroundColor: '#27ae6099',
            borderColor: '#27ae60',
            borderWidth: 2,
          },
          {
            label: 'Armée perdante (moy. unités)',
            data: sorted.map(u => u.avgLoser),
            backgroundColor: '#e74c3c99',
            borderColor: '#e74c3c',
            borderWidth: 2,
          }
        ]
      },
      options: {
        plugins: {
          title: { display: true, text: 'Composition armées — gagnants vs perdants', color: '#e0e0e0', font: { size: 15 } },
          legend: { labels: { color: '#ddd' } }
        },
        scales: {
          x: { ticks: { color: '#ddd' }, grid: { color: '#333' } },
          y: { ticks: { color: '#aaa' }, grid: { color: '#333' }, title: { display: true, text: 'Nb unités moyen', color: '#aaa' } }
        }
      }
    });
  }

  console.log('\nTous les graphiques générés dans simulation/charts/');
}

main().catch(console.error);
