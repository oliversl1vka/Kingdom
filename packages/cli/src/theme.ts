const useColor = !process.argv.includes('--no-color') && process.env.NO_COLOR === undefined;

function colorize(text: string, code: string): string {
  return useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
}

const green = (t: string) => colorize(t, '32');
const red = (t: string) => colorize(t, '31');
const yellow = (t: string) => colorize(t, '33');
const cyan = (t: string) => colorize(t, '36');
const bold = (t: string) => colorize(t, '1');
const dim = (t: string) => colorize(t, '2');

export function success(message: string): void {
  console.log(green(`⚔️  ${message}`));
}

export function error(message: string): void {
  console.error(red(`💀 A plague upon the kingdom! ${message}`));
}

export function warning(message: string): void {
  console.warn(yellow(`📜 The scribe counsels caution: ${message}`));
}

export function info(message: string): void {
  console.log(cyan(`🏰 ${message}`));
}

export function decree(message: string): void {
  console.log(bold(`👑 The decree hath been issued: ${message}`));
}

export function herald(message: string): void {
  console.log(dim(`📯 ${message}`));
}

export function banner(): void {
  console.log(
    bold(`
╔══════════════════════════════════════╗
║         ⚔️  K I N G D O M O S  ⚔️     ║
║   Autonomous Hierarchical Agents    ║
╚══════════════════════════════════════╝
`)
  );
}

export const theme = {
  success,
  error,
  warning,
  info,
  decree,
  herald,
  banner,
};
