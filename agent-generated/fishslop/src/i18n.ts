// English and Spanish strings. The language comes from ?lang=, then the player's last choice,
// then the browser's preferred languages in order, then English.

export type Lang = 'en' | 'es';

const en = {
  // HUD
  hudFish: 'Fish',
  hudPellets: 'Pellets',
  hudDepth: 'Depth',
  hudEgg: 'Egg',
  hudContact: 'Next contact',
  hints:
    '<b>WASD</b> swim · <b>Mouse</b> look · <b>Space/C</b> up/down · <b>Shift</b> boost · <b>Click/F</b> feed · ' +
    '<b>Right-click/R</b> harpoon · <b>1–6</b> shop · <b>M</b> sound · <b>Esc</b> pause',
  contactNow: 'CONTACT',
  monster: 'Monster',
  alertMonster: 'Monster in the tank. Harpoon it: right-click or R',
  alertMonsterTouch: 'Monster in the tank. Hold the harpoon button',
  alertSonar: 'Sonar contact. Something big arrives in {n}',
  max: 'MAX',
  touchFeed: 'Feed',
  touchFire: 'Harpoon',
  touchUp: 'Up',
  touchDown: 'Down',
  touchPause: 'Pause',

  // Shop
  shopGuppy: 'Guppy',
  shopFood: 'Better food',
  shopCapacity: 'More pellets',
  shopMagnet: 'Coin magnet',
  shopHarpoon: 'Harpoon',
  shopEgg: 'Egg piece',
  // Short labels for the one-row shop on a phone held sideways. The + marks an upgrade.
  shortGuppy: 'Guppy',
  shortFood: 'Food+',
  shortCapacity: 'Pellets+',
  shortMagnet: 'Magnet+',
  shortHarpoon: 'Harpoon+',
  shortEgg: 'Egg',
  detailGuppy: 'Fry. Feed it to grow',
  detailFood: '{n} growth per pellet',
  detailCapacity: '{n} pellets at once',
  detailMagnet: '{n} m pull',
  detailHarpoon: '{n} dmg per bolt',
  detailEgg: '{n}/{m} pieces',

  // Fish stages
  stage0: 'Fry',
  stage1: 'Guppy',
  stage2: 'Big guppy',
  stage3: 'King guppy',

  // Toasts
  toastStart: 'Feed your guppies before they turn green',
  toastKing: 'A king guppy! It drops gems.',
  toastStarved: 'A {stage} starved. Watch for green fish.',
  toastEaten: 'The monster ate a fish!',
  toastPelletCap: 'Only {n} pellets at once. Upgrade with 3',
  toastPelletCapTouch: 'Only {n} pellets at once. Buy More pellets',
  toastMaxed: '{name} is maxed out',
  toastFunds: 'Not enough coins',
  toastGuppy: 'New guppy in the tank',
  toastEgg: 'Egg piece {n} of 3',
  toastUpgraded: '{name} upgraded',
  toastSoundOff: 'Sound off',
  toastSoundOn: 'Sound on',
  toastMonsterDown: 'Monster down! Grab the treasure: {n} coins',

  // Title
  otherLang: 'Español',
  otherLangLabel: 'Cambiar a español',
  tagline:
    'You pilot the feeding sub. Keep the guppies fed, grow them, scoop up what they drop, and harpoon whatever comes through the glass.',
  howFeedTitle: 'Feed',
  howFeed: 'Drop pellets with click or F. Hungry fish turn green; starving ones die.',
  howFeedTouch: 'Tap Feed to drop pellets. Hungry fish turn green; starving ones die.',
  howGrowTitle: 'Grow',
  howGrow: 'Fry become guppies, big guppies, then kings. Bigger fish drop richer coins.',
  howCollectTitle: 'Collect',
  howCollect: 'Swim near coins to scoop them up before they fade on the sand.',
  howDefendTitle: 'Defend',
  howDefend: 'Monsters arrive on a timer. Harpoon them with right-click or R.',
  howDefendTouch: 'Monsters arrive on a timer. Hold Harpoon to fire at them.',
  howWinTitle: 'Win',
  howWin: 'Buy all three egg pieces.',
  start: 'Dive in',
  touchHelp: 'Left thumb steers, drag past the ring to boost. Right thumb looks around.',
  credits: "Inspired by Insaniquarium and Theo's Fishslop benchmark. Built from scratch with Three.js by Claude.",

  // Pause and end
  paused: 'Paused',
  pausedBody: 'You can still shop with the buttons below or keys 1–6.',
  pausedBodyTouch: 'You can still shop with the buttons below.',
  resume: 'Resume',
  restart: 'Play again',
  wonTitle: 'The egg hatched',
  wonBody: 'All three egg pieces are yours. Whatever was inside is very pleased with you.',
  lostTitle: 'The tank went quiet',
  lostBody: 'No fish left and not enough coins for another. Every keeper loses a tank eventually.',
  statTime: 'Time',
  statEarned: 'Coins earned',
  statSlain: 'Monsters harpooned',
  statKings: 'King guppies raised',
  statLost: 'Fish lost',
};

export type Key = keyof typeof en;

const es: Record<Key, string> = {
  hudFish: 'Peces',
  hudPellets: 'Bolitas',
  hudDepth: 'Profundidad',
  hudEgg: 'Huevo',
  hudContact: 'Próximo contacto',
  hints:
    '<b>WASD</b> nadar · <b>Mouse</b> mirar · <b>Espacio/C</b> subir/bajar · <b>Shift</b> turbo · <b>Clic/F</b> alimentar · ' +
    '<b>Clic der./R</b> arpón · <b>1–6</b> tienda · <b>M</b> sonido · <b>Esc</b> pausa',
  contactNow: 'CONTACTO',
  monster: 'Monstruo',
  alertMonster: 'Monstruo en la pecera. Arponéalo: clic derecho o R',
  alertMonsterTouch: 'Monstruo en la pecera. Mantén el botón del arpón',
  alertSonar: 'Contacto de sonar. Algo grande llega en {n}',
  max: 'MÁX',
  touchFeed: 'Comida',
  touchFire: 'Arpón',
  touchUp: 'Subir',
  touchDown: 'Bajar',
  touchPause: 'Pausa',

  shopGuppy: 'Guppy',
  shopFood: 'Mejor comida',
  shopCapacity: 'Más bolitas',
  shopMagnet: 'Imán de monedas',
  shopHarpoon: 'Arpón',
  shopEgg: 'Pieza de huevo',
  shortGuppy: 'Guppy',
  shortFood: 'Comida+',
  shortCapacity: 'Bolitas+',
  shortMagnet: 'Imán+',
  shortHarpoon: 'Arpón+',
  shortEgg: 'Huevo',
  detailGuppy: 'Alevín. Aliméntalo para que crezca',
  detailFood: '{n} de crecimiento por bolita',
  detailCapacity: '{n} bolitas a la vez',
  detailMagnet: 'Atrae a {n} m',
  detailHarpoon: '{n} de daño por arpón',
  detailEgg: '{n}/{m} piezas',

  stage0: 'Alevín',
  stage1: 'Guppy',
  stage2: 'Guppy grande',
  stage3: 'Guppy rey',

  toastStart: 'Alimenta a tus guppies antes de que se pongan verdes',
  toastKing: '¡Un guppy rey! Suelta gemas.',
  toastStarved: 'Un {stage} murió de hambre. Vigila a los peces verdes.',
  toastEaten: '¡El monstruo se comió un pez!',
  toastPelletCap: 'Solo {n} bolitas a la vez. Mejóralo con el 3',
  toastPelletCapTouch: 'Solo {n} bolitas a la vez. Compra Más bolitas',
  toastMaxed: '{name} ya está al máximo',
  toastFunds: 'No te alcanzan las monedas',
  toastGuppy: 'Nuevo guppy en la pecera',
  toastEgg: 'Pieza de huevo {n} de 3',
  toastUpgraded: 'Mejora comprada: {name}',
  toastSoundOff: 'Sonido apagado',
  toastSoundOn: 'Sonido encendido',
  toastMonsterDown: '¡Monstruo abatido! Recoge el tesoro: {n} monedas',

  otherLang: 'English',
  otherLangLabel: 'Switch to English',
  tagline:
    'Pilotas el submarino alimentador. Mantén a los guppies bien comidos, hazlos crecer, recoge lo que sueltan y arponea lo que se cuele por el vidrio.',
  howFeedTitle: 'Alimenta',
  howFeed: 'Suelta bolitas con clic o F. Los peces con hambre se ponen verdes; si no comen, mueren.',
  howFeedTouch: 'Toca Comida para soltar bolitas. Los peces con hambre se ponen verdes; si no comen, mueren.',
  howGrowTitle: 'Crece',
  howGrow: 'Los alevines se vuelven guppies, guppies grandes y luego reyes. Los peces más grandes sueltan mejores monedas.',
  howCollectTitle: 'Recoge',
  howCollect: 'Nada cerca de las monedas para recogerlas antes de que se desvanezcan en la arena.',
  howDefendTitle: 'Defiende',
  howDefend: 'Los monstruos llegan cada cierto tiempo. Arponéalos con clic derecho o R.',
  howDefendTouch: 'Los monstruos llegan cada cierto tiempo. Mantén Arpón para dispararles.',
  howWinTitle: 'Gana',
  howWin: 'Compra las tres piezas del huevo.',
  start: '¡Al agua!',
  touchHelp: 'El pulgar izquierdo dirige; arrastra más allá del aro para el turbo. El derecho mira alrededor.',
  credits: 'Inspirado en Insaniquarium y en el benchmark Fishslop de Theo. Hecho desde cero con Three.js por Claude.',

  paused: 'En pausa',
  pausedBody: 'Puedes seguir comprando con los botones de abajo o con las teclas 1–6.',
  pausedBodyTouch: 'Puedes seguir comprando con los botones de abajo.',
  resume: 'Continuar',
  restart: 'Jugar otra vez',
  wonTitle: 'El huevo eclosionó',
  wonBody: 'Las tres piezas del huevo son tuyas. Lo que había dentro está muy contento contigo.',
  lostTitle: 'La pecera quedó en silencio',
  lostBody: 'No quedan peces ni monedas para comprar otro. Tarde o temprano, todo cuidador pierde una pecera.',
  statTime: 'Tiempo',
  statEarned: 'Monedas ganadas',
  statSlain: 'Monstruos arponeados',
  statKings: 'Guppies rey criados',
  statLost: 'Peces perdidos',
};

const STRINGS: Record<Lang, Record<Key, string>> = { en, es };
const STORE = 'fishslop.lang';

const isLang = (v: unknown): v is Lang => v === 'en' || v === 'es';

function preferred(): string[] {
  return navigator.languages?.length ? [...navigator.languages] : [navigator.language];
}

export function detectLang(): Lang {
  const q = new URLSearchParams(location.search).get('lang');
  if (isLang(q)) return q;
  try {
    const saved = localStorage.getItem(STORE);
    if (isLang(saved)) return saved;
  } catch {
    // Storage blocked: fall through to the browser languages.
  }
  for (const tag of preferred()) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

export let lang: Lang = detectLang();
/** Touch players get the touch wording, where a string has a `…Touch` variant. */
let touch = false;
// Format numbers the way the player's own region does (es-MX 1,500 vs es-ES 1500), as long as it's this language.
let numberLocale = '';

function refreshLocale() {
  numberLocale = lang;
  for (const tag of preferred()) {
    if (tag.toLowerCase().split('-')[0] !== lang) continue;
    try {
      // Browsers can report tags Intl rejects (Linux gives en-US@posix), which would throw on every format.
      numberLocale = Intl.getCanonicalLocales(tag)[0];
      return;
    } catch {
      // Try the next one.
    }
  }
}
refreshLocale();

export function t(key: Key, params: Record<string, string | number> = {}): string {
  const table = STRINGS[lang];
  const touchKey = `${key}Touch` as Key;
  const s = touch && touchKey in table ? table[touchKey] : table[key];
  return s.replace(/\{(\w+)\}/g, (_, p: string) => String(params[p] ?? `{${p}}`));
}

export const num = (n: number) => n.toLocaleString(numberLocale);

/** Fills every [data-i18n] (text) and [data-i18n-html] (our own markup) element. */
export function applyStatic(root: ParentNode = document) {
  document.documentElement.lang = lang;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n as Key)));
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml as Key)));
  root.querySelectorAll<HTMLElement>('[data-i18n-label]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nLabel as Key)));
}

export function setLang(next: Lang) {
  lang = next;
  refreshLocale();
  try {
    localStorage.setItem(STORE, next);
  } catch {
    // Not remembered, which is fine.
  }
  applyStatic();
}

export function setTouchWording(on: boolean) {
  touch = on;
  applyStatic();
}
