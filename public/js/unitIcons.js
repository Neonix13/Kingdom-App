// Unit emblems (48×48 filled silhouettes in currentColor): used wherever a unit needs a small symbol
(function () {
  const S = (d) => `<svg class="ku-ico" viewBox="0 0 48 48" fill="currentColor" fill-rule="evenodd" aria-hidden="true">${d}</svg>`;
  const horse = 'M12 45C10 36 10 26 14 18L15 10L17 4L20.5 10C24 10 27 12 30 16L38 25C41 28 42 31 40 33.5C38.5 35 36 34.5 34 33L29 31C27 31 25.5 32 25.5 34C25.5 38 27.5 42 29 45Z'
    + 'M23.4 17.2a1.7 1.2 0 1 0 3.4 0a1.7 1.2 0 1 0-3.4 0Z' + 'M36.4 29.4a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0Z';
  const mane = '<path d="M14 18C9 20 6.5 26 7.5 33C8.5 29 10 26 12.5 24C9.5 29 9.5 35 11 40C11.3 34 12.4 29.5 14.2 26.5Z"/>';
  const bow = '<path d="M5 17C6 9 9 6 17 5C29 6 40 14 42 27C43 35 40 40 31 43" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>'
    + '<path d="M5 17L31 43" stroke="currentColor" stroke-width="1.4"/>'
    + '<path d="M9 39L36 12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'
    + '<path d="M43 5L40.5 15.5L32.5 7.5Z"/>'
    + '<path d="M11 37L5 37L3 40L8.5 40Z"/><path d="M11 37L11 43L8 45L8 39.5Z"/>';
  const ICONS = {
    pietaille: S('<path d="M14 4V12C14 17 18 20.5 24 20.5S34 17 34 12V4" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>'
      + '<rect x="22.4" y="3" width="3.2" height="19" rx="1.6"/><rect x="22.4" y="19" width="3.2" height="26" rx="1.6"/><rect x="19" y="21" width="10" height="3" rx="1.5"/>'),
    soldats: S('<path d="M24 2L27.5 9V31H20.5V9ZM23.3 10.5V29H24.7V10.5Z"/><rect x="12.5" y="31" width="23" height="4" rx="2"/>'
      + '<rect x="21.8" y="35" width="4.4" height="7" rx="1"/><circle cx="24" cy="44" r="2.7"/>'),
    phalange: S(''
      + '<path d="M24 5L40 10V22C40 33 33 40 24 44C15 40 8 33 8 22V10ZM24 9L36.4 12.9V22C36.4 30.8 31 36.4 24 40C17 36.4 11.6 30.8 11.6 22V12.9Z"/>'
      + '<path d="M24 13L32.8 15.8V22C32.8 28.5 29 33 24 35.9C19 33 15.2 28.5 15.2 22V15.8ZM22.8 17V32H25.2V17Z"/>'),
    lancier: S('<path d="M24 1.5C28.3 6.5 28.3 11.5 24 16.5C19.7 11.5 19.7 6.5 24 1.5ZM23.4 5V14H24.6V5Z"/><rect x="21.2" y="16.5" width="5.6" height="2.6" rx="1"/>'
      + '<rect x="22.7" y="19" width="2.6" height="27" rx="1.3"/><path d="M22.4 20C17.5 22.5 15.8 27.5 17.6 32.5C18.6 28.5 20.4 25.6 22.4 23.6Z"/><path d="M25.6 20C30.5 22.5 32.2 27.5 30.4 32.5C29.4 28.5 27.6 25.6 25.6 23.6Z"/>'),
    espion: S('<path d="M24 3C34.5 3 42.5 12.5 42.5 26C42.5 36.5 36 43.5 24 45C12 43.5 5.5 36.5 5.5 26C5.5 12.5 13.5 3 24 3ZM24 13.5C30.8 13.5 35 18.6 35 25S30.8 37 24 37S13 31.4 13 25S17.2 13.5 24 13.5Z"/>'
      + '<path d="M13 21.5H35V28.5H13ZM16.6 25a2.9 1.8 0 1 0 5.8 0a2.9 1.8 0 1 0-5.8 0ZM25.6 25a2.9 1.8 0 1 0 5.8 0a2.9 1.8 0 1 0-5.8 0Z"/>'),
    assassin: S('<path d="M24 46L20.2 31V20.5H27.8V31ZM23.4 22V33H24.6V22Z"/><rect x="14.5" y="17" width="19" height="3.6" rx="1.8"/>'
      + '<rect x="21.8" y="7.5" width="4.4" height="9.5" rx="1"/><circle cx="24" cy="5.2" r="2.8"/>'
      + '<path d="M35.5 31C35.5 31 31.5 36 31.5 38.8a4 4 0 0 0 8 0C39.5 36 35.5 31 35.5 31Z"/>'),
    cavalier_leger: S(`<path d="${horse}"/>${mane}`),
    cavalier_lourd: S(`<path d="${horse}M24.2 14.2L34.6 22.6L33.2 24.2L22.8 15.8Z"/>${mane}`
      + '<path d="M17 4.5C14.5 1 18.5-.5 21.5 1.5C23.2 2.6 24 4.4 23.5 6C22 4.5 20 4 18.5 5.5Z"/><path d="M9 39H31L28.5 46H11.5Z"/>'),
    archer: S(bow),
    archer_elite: S('<g transform="translate(10 11) scale(.76)">' + bow + '</g><path d="M1.5 12L2.6 2.5L6.6 6.6L9.5 1L12.4 6.6L16.4 2.5L17.5 12Z"/><rect x="1.5" y="13.3" width="16" height="2.8" rx="1"/>'),
    batisseurs: S('<g transform="rotate(-38 24 24)"><path d="M11 5H33C35 5 36.5 6.5 36.5 8.5V12.5C36.5 14.5 35 16 33 16H11Z"/><path d="M11 5L7 7V14L11 16Z"/><rect x="21.6" y="16" width="4.8" height="29" rx="2.2"/></g>'
      + '<g transform="rotate(38 24 24)"><path d="M21.5 4H26.5V16H21.5ZM21.5 4L24 1.5L26.5 4Z"/><rect x="20.8" y="18" width="6.4" height="25" rx="3"/><rect x="22.4" y="16" width="3.2" height="2.5"/></g>'),
    char: S('<path d="M24 3a21 21 0 1 0 .01 0ZM24 7.6a16.4 16.4 0 1 1-.01 0Z"/><circle cx="24" cy="24" r="5"/>'
      + '<g stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M24 8V19M24 29V40M8 24H19M29 24H40M12.7 12.7L20.5 20.5M27.5 27.5L35.3 35.3M35.3 12.7L27.5 20.5M20.5 27.5L12.7 35.3"/></g>'
      + '<path d="M24 22.2a1.8 1.8 0 1 0 .01 0Z" fill="#000" fill-opacity=".35"/>'),
    general: S('<rect x="8.5" y="5" width="3.2" height="41" rx="1.6"/><circle cx="10.1" cy="4" r="3"/>'
      + '<path d="M11.7 7C19.5 3.5 25.5 10 33.5 6.8C36.5 5.6 39.5 5.4 42.5 6.5L38.5 14.5L42.5 22.5C34.5 21.3 28.5 25.8 20 22.8C17 21.8 14.3 21.8 11.7 22.8Z'
      + 'M25 10.5L26.3 13.2L29.2 13.5L27 15.5L27.6 18.4L25 16.9L22.4 18.4L23 15.5L20.8 13.5L23.7 13.2Z"/>'),
  };
  self.KB_UNIT_ICONS = ICONS;
  self.KBUnitIcon = (typeId, isGeneral) => (isGeneral ? ICONS.general : ICONS[typeId] || ICONS.soldats);
})();
