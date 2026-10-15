import { createServer, type Server } from 'node:net';

export interface ReceivedMail {
  from: string;
  to: string[];
  data: string;
}

/** Minimal SMTP sink (plain, no TLS) that records messages; `fail` makes it reject DATA. */
export async function smtpSink(): Promise<{ port: number; mails: ReceivedMail[]; fail: { on: boolean }; close: () => Promise<void> }> {
  const mails: ReceivedMail[] = [];
  const fail = { on: false };
  const server: Server = createServer((sock) => {
    let buf = '';
    let inData = false;
    let cur: ReceivedMail = { from: '', to: [], data: '' };
    sock.write('220 sink ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          cur.data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          if (fail.on) sock.write('554 rejected by test\r\n');
          else {
            mails.push(cur);
            sock.write('250 queued\r\n');
          }
          cur = { from: '', to: [], data: '' };
          continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-sink\r\n250 8BITMIME\r\n');
        else if (cmd === 'MAIL') (cur.from = line), sock.write('250 ok\r\n');
        else if (cmd === 'RCPT') (cur.to.push(line.replace(/^RCPT TO:\s*<?([^>]*)>?.*$/i, '$1')), sock.write('250 ok\r\n'));
        else if (cmd === 'DATA') (inData = true), sock.write('354 go\r\n');
        else if (cmd === 'QUIT') (sock.write('221 bye\r\n'), sock.end());
        else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { port, mails, fail, close: () => new Promise((r) => server.close(() => r())) };
}
