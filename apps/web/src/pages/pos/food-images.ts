/**
 * Food emoji helpers — used by the menu grid to give every product a colorful
 * visual fallback. Reuses the prior POSPro logic verbatim so the look stays
 * consistent across cashier sessions.
 */
const EMOJI_BY_NAME: Record<string, string> = {
  coffee: '☕', latte: '☕', cappuccino: '☕', espresso: '☕', americano: '☕', mocha: '☕',
  tea: '🍵', milk_tea: '🧋', bubble: '🧋', smoothie: '🥤', juice: '🧃', soda: '🥤',
  beer: '🍺', wine: '🍷', cocktail: '🍸', water: '💧', milkshake: '🥛',
  pizza: '🍕', burger: '🍔', sandwich: '🥪', fries: '🍟', chips: '🍟',
  chicken: '🍗', wings: '🍗', fried_chicken: '🍗',
  rice: '🍚', noodles: '🍜', pasta: '🍝', spaghetti: '🍝', lasagna: '🍝',
  salad: '🥗', soup: '🥣', bread: '🍞', toast: '🍞',
  cake: '🎂', pie: '🥧', donut: '🍩', pancake: '🥞', waffle: '🧇',
  ice_cream: '🍦', cupcake: '🧁', muffin: '🧁', chocolate: '🍫', candy: '🍬',
  cookie: '🍪', brownie: '🍫',
  apple: '🍎', banana: '🍌', orange: '🍊', grape: '🍇', strawberry: '🍓',
  watermelon: '🍉', pineapple: '🍍', mango: '🥭', avocado: '🥑', lemon: '🍋',
  fish: '🐟', shrimp: '🍤', crab: '🦀', lobster: '🦞', egg: '🥚', bacon: '🥓', steak: '🥩', meat: '🥩',
  corn: '🌽', carrot: '🥕', broccoli: '🥦', pepper: '🌶️', tomato: '🍅', cucumber: '🥒',
  potato: '🥔', mushroom: '🍄', garlic: '🧄', onion: '🧅',
  sushi: '🍣', dumpling: '🥟', spring_roll: '🌯', taco: '🌮', burrito: '🌯', kebab: '🍢',
  ramen: '🍜', curry: '🍛',
};

const CATEGORY_EMOJI: Record<string, string> = {
  drinks: '🥤', beverages: '🥤', coffee: '☕', tea: '🍵', beer: '🍺', cocktails: '🍸', smoothies: '🥤',
  food: '🍽️', mains: '🍛', meals: '🍱', breakfast: '🥞', lunch: '🥗', dinner: '🍽️',
  pizza: '🍕', pasta: '🍝', burgers: '🍔', sandwiches: '🥪', salads: '🥗', soups: '🥣',
  desserts: '🍰', sweets: '🍰', cakes: '🎂', pastries: '🥐', ice_cream: '🍦',
  snacks: '🍿', sides: '🍟', appetizers: '🥟', starters: '🥗',
  fruits: '🍎', vegetables: '🥦', vegan: '🥗', healthy: '🥗',
  seafood: '🦐', chicken: '🍗', beef: '🥩', pork: '🥩',
  rice: '🍚', noodles: '🍜', asian: '🍜', chinese: '🥡', japanese: '🍣', indian: '🍛', mexican: '🌮',
  bakery: '🥐', bread: '🍞',
  kids: '🧃', combo: '🍱', special: '⭐', offers: '🏷️',
};

export function getFoodEmoji(name: string, categoryName?: string): string {
  const n = (name || '').toLowerCase();
  for (const k of Object.keys(EMOJI_BY_NAME)) {
    if (n.includes(k)) return EMOJI_BY_NAME[k];
  }
  const c = (categoryName || '').toLowerCase();
  for (const k of Object.keys(CATEGORY_EMOJI)) {
    if (c.includes(k)) return CATEGORY_EMOJI[k];
  }
  return '🍽️';
}