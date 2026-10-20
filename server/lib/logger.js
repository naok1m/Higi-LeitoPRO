// Logs em texto simples no stdout/stderr. Em produção o NSSM grava essas saídas
// em logs\*.log com rotação, então não precisamos de biblioteca de log.
const write = (level, message, error) => {
  const line = `${new Date().toISOString()} ${level} ${message}`;
  const details = error ? `\n${error.stack || error}` : '';
  if (level === 'INFO') console.log(line);
  else console.error(`${line}${details}`);
};

export const logger = {
  info: (message) => write('INFO', message),
  warn: (message, error) => write('WARN', message, error),
  error: (message, error) => write('ERROR', message, error),
};
