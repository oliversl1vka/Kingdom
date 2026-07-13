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

function success(message: string): void {
  console.log(green(`✓ ${message}`));
}

function error(message: string): void {
  console.error(red(`✗ A plague upon the kingdom! ${message}`));
}

function warning(message: string): void {
  console.warn(yellow(`! The scribe counsels caution: ${message}`));
}

function info(message: string): void {
  console.log(cyan(message));
}

function decree(message: string): void {
  console.log(bold(`The decree hath been issued: ${message}`));
}

function banner(): void {
  const width = 38;
  const top = '╔' + '═'.repeat(width) + '╗';
  const bottom = '╚' + '═'.repeat(width) + '╝';
  const center = (s: string) => {
    const pad = Math.max(0, width - s.length);
    const left = Math.floor(pad / 2);
    return '║' + ' '.repeat(left) + s + ' '.repeat(pad - left) + '║';
  };
  console.log(
    bold(
      '\n' +
        [
          top,
          center('K I N G D O M O S'),
          center('Autonomous Hierarchical Agents'),
          bottom,
        ].join('\n') +
        '\n'
    )
  );
}

export const theme = {
  success,
  error,
  warning,
  info,
  decree,
  banner,
};
