// Generates the colored terminal block-art panda used by install.sh's banner.
// Renders the exact same sprite/palette as the app icon via ANSI truecolor
// half-blocks (▀▄), so the terminal banner matches the real Mr. Panda design.
const SPRITE = [
  "..KKKK............KKKK..",
  ".KKKKKK..........KKKKKK.",
  ".KKKKWWWWWWWWWWWWWWKKKK.",
  "..KKWWWWWWWWWWWWWWWWKK..",
  "..WWWWWWWWWWWWWWWWWWWW..",
  "..WWSSSSSSSSSSSSSSSSWW..",
  "..WWSXSSSSSSSSSSSSXSWW..",
  "..WWWSSSSSSSSSSSSSSWWW..",
  "..WWWWWWWWWWWWWWWWWWWW..",
  "..WWWWWWWWWNNWWWWWWWWW..",
  "..WWWWWWWWWWWWWWWWWWWW..",
  "...WWWWWWWWWWWWWWWWWW...",
  "....TTTTTHHHHHHTTTTT....",
  "...TTTTTTTHRRHTTTTTTT...",
  "...TTTTTTTHRRHTTTTTTT...",
  "..TTTTTTTTTRRTTTTTTTTT..",
  "..TTTTTTTTTDRTTTTTTTTT..",
  "..KKKTTTTTTTTTTTTTTKKK..",
  "..KKKTTTTTTTTTTTTTTKKK..",
  "....TTTTTTTTTTTTTTTT....",
  ".....TTTTTT..TTTTTT.....",
  ".....TTTTTT..TTTTTT.....",
  "....KKKKKK....KKKKKK....",
  "....KKKKKK....KKKKKK...."
];
const HEX = { K: '17171C', W: 'F2EFE4', N: '17171C', S: '0D1015', X: '9FD8FF', T: '26262E', H: 'F6F4EC', R: 'C0392B', D: 'E8C766' };

const ESC = String.fromCharCode(27);
function rgb(hex) { return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]; }
function fg(hex) { const [r, g, b] = rgb(hex); return ESC + '[38;2;' + r + ';' + g + ';' + b + 'm'; }
function bg(hex) { const [r, g, b] = rgb(hex); return ESC + '[48;2;' + r + ';' + g + ';' + b + 'm'; }
const RESET = ESC + '[0m';
const UPPER = '▀'; // upper half block
const LOWER = '▄'; // lower half block

const lines = [];
for (let r = 0; r < SPRITE.length; r += 2) {
  let line = '';
  const top = SPRITE[r], bot = SPRITE[r + 1] || SPRITE[r];
  for (let c = 0; c < top.length; c++) {
    const tc = top[c], bc = bot[c];
    if (tc === '.' && bc === '.') { line += ' '; continue; }
    const tcol = tc === '.' ? null : HEX[tc];
    const bcol = bc === '.' ? null : HEX[bc];
    if (tcol && bcol) line += fg(tcol) + bg(bcol) + UPPER + RESET;
    else if (tcol) line += fg(tcol) + UPPER + RESET;
    else line += fg(bcol) + LOWER + RESET;
  }
  lines.push(line);
}

if (process.argv[2] === '--shell') {
  // Emit a bash heredoc-friendly block for install.sh
  console.log(lines.map(l => l).join('\n'));
} else {
  console.log(lines.join('\n'));
}
