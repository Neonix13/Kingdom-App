// Line icons for unit types (24×24, drawn with currentColor): used wherever a unit needs a small symbol
(function () {
  const S = (d) => `<svg class="ku-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const horse = '<path d="M6 21l1-7c-2-2-2-6 0-8l1-4 2 3c2-.5 5 0 7 2l4 4c.5 1 0 2-1 2l-3-.5-3-1.5-1 3 2 7"/><path d="M8 6c-1 3-1 6 0 8"/><circle cx="13" cy="8" r=".7" fill="currentColor"/>';
  const bow = '<path d="M8 3C2 8 2 16 8 21"/><path d="M8 3v18"/><path d="M5 12h16"/><path d="M18 9l3 3-3 3"/><path d="M5 12l-2-2M5 12l-2 2"/>';
  const ICONS = {
    pietaille: S('<path d="M12 21V9"/><path d="M7 3v3a5 5 0 0 0 10 0V3"/><path d="M12 3v8"/>'),
    soldats: S('<path d="M8 16L19 5l1-1"/><path d="M6 13l5 5"/><path d="M8 16l-3.5 3.5"/><circle cx="4" cy="20" r="1"/>'),
    phalange: S('<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z"/><path d="M12 8v8"/><path d="M8.5 11.5h7"/>'),
    lancier: S('<path d="M4 20L15 9"/><path d="M14 10l2-6.5L20.5 8 14 10z"/><path d="M11 10.5l2.5 2.5"/>'),
    espion: S('<path d="M2 12c3-6 17-6 20 0-3 6-17 6-20 0z"/><circle cx="12" cy="12" r="3"/>'),
    assassin: S('<path d="M12 2l2 7h-4z" fill="currentColor"/><path d="M8 9h8"/><path d="M12 9v9"/><circle cx="12" cy="20" r="1.5"/>'),
    cavalier_leger: S(horse),
    cavalier_lourd: S(horse + '<path d="M14 7l5 3.5"/><path d="M8 9.5h3"/><path d="M8.5 2.5c0-1.5 2-2 3-1"/>'),
    archer: S(bow),
    archer_elite: S(bow + '<path d="M19.5 1.8l.7 1.5 1.6.2-1.2 1.1.3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1.1 1.6-.2z" fill="currentColor" stroke-width="1"/>'),
    batisseurs: S('<path d="M3.5 8.5L10 3.5l3 3-6.5 5z"/><path d="M10.5 8.5L20 19"/>'),
    char: S('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M12 3.5v6.5M12 14v6.5M3.5 12H10M14 12h6.5M6 6l4.6 4.6M13.4 13.4L18 18M18 6l-4.6 4.6M10.6 13.4L6 18"/>'),
    general: S('<path d="M5 21V3"/><path d="M5 4h13l-3 4 3 4H5"/>'),
  };
  self.KB_UNIT_ICONS = ICONS;
  self.KBUnitIcon = (typeId, isGeneral) => (isGeneral ? ICONS.general : ICONS[typeId] || ICONS.soldats);
})();
