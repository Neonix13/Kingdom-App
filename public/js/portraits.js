// Portrait images (manga panels) of generals and unit types, for pages that don't load game.js.
const GENERALS = {
  ou_ki: ['OU KI 1-1', 'jpg'], ou_sen: ['OU SEN 1-1', 'png'], mou_bu: ['MOU BU 1-1', 'jpg'], kan_ki: ['KAN KI 1-1', 'jpg'],
  ri_boku: ['RI BOKU 1-1', 'jpg'], kei_sha: ['KEI SHA 1-1', 'jpg'], shi_ba_shou: ['SHI BA SHOU 1-1', 'jpg'], ren_pa: ['REN PA 1-1', 'jpg'],
  go_hou_mei: ['GO HOU MEI 1-1', 'jpg'], gai_mou: ['GAI MOU', 'jpg'],
};
const UNITS = {
  pietaille: ['PIETAILLE 1-1', 'jpeg'], soldats: ['SOLDAT', 'jpg'], phalange: ['PHALANGE 1-1', 'png'], lancier: ['LANCIER 1-1', 'jpg'],
  espion: ['ESPION 1-1', 'png'], assassin: ['ASSASSIN 1-1', 'jpg'], cavalier_leger: ['CAVALIER LEGER 1-1', 'jpg'], cavalier_lourd: ['CAVALIER LOURD 1-1', 'jpg'],
  archer: ['ARCHER 1-1', 'jpg'], archer_elite: ["ARCHER D'ELITE 1-1", 'jpg'], batisseurs: ['BATISSEUR 1-1', 'jpg'], char: ['CHAR 1-1', 'png'],
};
export const UNIT_KANJI = { pietaille: '卒', soldats: '兵', phalange: '盾', lancier: '槍', espion: '諜', assassin: '刺', cavalier_leger: '騎', cavalier_lourd: '騎', archer: '弓', archer_elite: '弓', batisseurs: '工', char: '車' };

const url = (folder, e) => (e ? `/assets/unites/${folder}/${encodeURIComponent(e[0])}.${e[1]}` : null);
export const generalPortrait = (generalId) => url('GENERAL IMAGE 1-1', GENERALS[generalId]);
export const unitPortrait = (typeId) => url('UNIT IMAGE 1-1', UNITS[typeId]);
export const unitKanji = (u) => (u.isGeneral ? '将' : UNIT_KANJI[u.typeId] || '兵');
