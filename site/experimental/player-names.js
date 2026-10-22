/* Local adjective + animal dictionaries, inspired by unique-names-generator.
 * No name API, account, personal information or network request is needed.
 */
(function (root) {
  'use strict';
  const adjectives = ['Accidental','Adventurous','Anxious','Awkward','Baffled','Bouncy','Brave','Breezy','Chaotic','Cheerful','Clumsy','Confused','Cosmic','Curious','Dizzy','Dramatic','Dreamy','Fancy','Fearless','Fluffy','Forgetful','Grumpy','Hungry','Invisible','Jolly','Lost','Lucky','Majestic','Mischievous','Nervous','Noisy','Overexcited','Polite','Puzzled','Reckless','Restless','Sleepy','Sneaky','Snoring','Spicy','Squeaky','Stubborn','Suspicious','Tiny','Unsupervised','Wandering','Wobbly','Zooming'];
  const animals = ['Alpaca','Axolotl','Badger','Beaver','Bison','Capybara','Chinchilla','Cobra','Corgi','Crab','Crow','Duck','Ferret','Flamingo','Fox','Frog','Gecko','Goat','Goose','Hamster','Hedgehog','Heron','Iguana','Kiwi','Koala','Lemur','Llama','Lobster','Marmot','Meerkat','Moose','Narwhal','Newt','Octopus','Otter','Owl','Panda','Parrot','Penguin','Pigeon','Platypus','Puffin','Quokka','Raccoon','Raven','Salamander','Seal','Sloth','Squirrel','Turtle','Walrus','Wombat','Yak'];
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function index(length) {
    const sample = new Uint32Array(1), limit = Math.floor(4294967296 / length) * length;
    do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
    return sample[0] % length;
  }
  function generate() { return adjectives[index(adjectives.length)] + ' ' + animals[index(animals.length)]; }
  function roomCode() {
    let code;
    do { code = Array.from({ length: 6 }, () => alphabet[index(alphabet.length)]).join(''); }
    while (!/[A-Z]/.test(code) || !/[2-9]/.test(code));
    return code;
  }
  const api = { generate, roomCode, adjectives, animals };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PeakNames = api;
})(typeof window === 'object' ? window : globalThis);
