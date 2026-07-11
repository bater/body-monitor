import { connect } from "cloudflare:sockets";
import type { Env } from "./env";

// Minimal SMTP-over-implicit-TLS client for Gmail (smtp.gmail.com:465).
// Workers block outbound port 25 but allow 465/587; we use 465 so TLS is on
// from the first byte and we skip the STARTTLS dance. Auth is AUTH LOGIN with a
// Gmail App Password (needs 2FA on the account). No third-party deps.

const CRLF = "\r\n";

class SmtpError extends Error {}

async function readReply(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  buf: { text: string }
): Promise<{ code: number; lines: string[] }> {
  // An SMTP reply is one or more lines; continuation lines are "NNN-...", the
  // final line is "NNN ...". Keep reading until a final line appears.
  while (true) {
    const finalLine = firstFinalLine(buf.text);
    if (finalLine) {
      const lines = buf.text.split(CRLF).filter(Boolean);
      const code = Number(finalLine.slice(0, 3));
      buf.text = "";
      return { code, lines };
    }
    const { value, done } = await reader.read();
    if (done) throw new SmtpError("SMTP connection closed unexpectedly");
    buf.text += decoder.decode(value, { stream: true });
  }
}

function firstFinalLine(text: string): string | null {
  for (const line of text.split(CRLF)) {
    // "250 OK" is final; "250-..." is a continuation
    if (/^\d{3} /.test(line)) return line;
  }
  return null;
}

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

/** Send one email through Gmail SMTP. Throws on any non-2xx SMTP step. */
export async function sendMail(env: Env, msg: EmailMessage): Promise<void> {
  const user = env.GMAIL_USER;
  const pass = env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new SmtpError("Gmail SMTP 未設定");

  const socket = connect(
    { hostname: "smtp.gmail.com", port: 465 },
    { secureTransport: "on", allowHalfOpen: false }
  );
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const buf = { text: "" };

  const send = (line: string) => writer.write(encoder.encode(line + CRLF));
  const expect = async (want: number, ctx: string) => {
    const { code, lines } = await readReply(reader, decoder, buf);
    if (code !== want) throw new SmtpError(`SMTP ${ctx}：${lines.join(" ") || code}`);
    return { code, lines };
  };

  try {
    await expect(220, "greeting");
    await send("EHLO body-buddy");
    await expect(250, "EHLO");
    await send("AUTH LOGIN");
    await expect(334, "AUTH LOGIN");
    await send(btoa(user));
    await expect(334, "username");
    await send(btoa(pass));
    await expect(235, "認證失敗（請確認 App 密碼）");
    await send(`MAIL FROM:<${user}>`);
    await expect(250, "MAIL FROM");
    await send(`RCPT TO:<${msg.to}>`);
    await expect(250, "RCPT TO");
    await send("DATA");
    await expect(354, "DATA");
    await writer.write(encoder.encode(buildMessage(user, msg)));
    await expect(250, "訊息傳送");
    await send("QUIT");
  } finally {
    try {
      await writer.close();
    } catch {
      // ignore close races
    }
  }
}

function buildMessage(from: string, msg: EmailMessage): string {
  // Dot-stuff the body (lines starting with "." get an extra dot) and terminate
  // with <CRLF>.<CRLF> per RFC 5321.
  const body = msg.text
    .replace(/\r?\n/g, CRLF)
    .split(CRLF)
    .map((l) => (l.startsWith(".") ? "." + l : l))
    .join(CRLF);
  const headers = [
    `From: Body Buddy <${from}>`,
    `To: <${msg.to}>`,
    `Subject: ${encodeSubject(msg.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ].join(CRLF);
  return headers + CRLF + CRLF + body + CRLF + "." + CRLF;
}

// RFC 2047 encoded-word so a non-ASCII (中文) subject survives transit.
function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(subject)));
  return `=?UTF-8?B?${b64}?=`;
}

/** Compose + send the invitation email. Returns false when SMTP isn't configured. */
export async function sendInviteEmail(env: Env, to: string, link: string): Promise<boolean> {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return false;
  const text = [
    "你好，",
    "",
    "你在等候名單上的 Body Buddy 邀請通過了！",
    "點下面的連結，用你的 Google 帳號登入即可開始使用：",
    "",
    link,
    "",
    "這個連結 7 天內有效，且僅限使用一次。",
    "",
    "— Body Buddy",
  ].join("\n");
  await sendMail(env, { to, subject: "你的 Body Buddy 邀請", text });
  return true;
}
