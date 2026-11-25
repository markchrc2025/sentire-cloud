import QRCode from "qrcode";
import { cookies } from "next/headers";
import { and, eq, isNull, gt, desc } from "drizzle-orm";
import { generateURI } from "otplib";
import { Messages, Notice, str, type SP } from "@/components/ui";
import { PasskeyRegister } from "@/components/PasskeyButtons";
import { requireSession } from "@/server/http/session";
import { db } from "@/server/db/client";
import { mfaFactors, sessions } from "@/server/db/schema";
import { decrypt } from "@/lib/crypto";
import { passkeyRegistrationOptions } from "@/server/account/passkeys";
import {
  addPasskeyAction, changePasswordAction, confirmTotpAction, endSessionAction, newRecoveryCodesAction, removeFactorAction, startTotpAction,
} from "../../portal-actions";

export const metadata = { title: "Security" };
const manila = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

export default async function Security({ searchParams }: { searchParams: SP }) {
  const s = await requireSession("/account/security");
  const sp = await searchParams;
  const factors = await db().select().from(mfaFactors).where(eq(mfaFactors.userId, s.user.id));
  const confirmed = factors.filter((f) => f.confirmedAt);
  const setupId = str(sp.setup);
  const setup = setupId ? factors.find((f) => f.id === setupId && !f.confirmedAt && f.type === "TOTP") : undefined;
  const qr = setup ? await QRCode.toDataURL(generateURI({ issuer: "Sentire Cloud", label: s.user.email, secret: decrypt(setup.secret) })) : null;
  const codes = sp.codes ? (await cookies()).get("sc_codes")?.value?.split(",") : undefined;
  const recovery = confirmed.find((f) => f.type === "RECOVERY_CODES");
  const left = recovery ? (JSON.parse(recovery.secret) as string[]).length : 0;
  const active = await db().select().from(sessions).where(and(eq(sessions.userId, s.user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()), eq(sessions.pendingMfa, false))).orderBy(desc(sessions.lastSeenAt));
  const passkeyOptions = await passkeyRegistrationOptions(s.user.id, s.user.email, s.user.name);
  const has2fa = confirmed.some((f) => f.type === "TOTP" || f.type === "PASSKEY");
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Security</h1>
      <div className="mt-4"><Messages sp={sp} /></div>
      {sp.required && !has2fa ? <Notice kind="error">Owners must use two-factor sign-in. Add an authenticator app or a passkey to continue.</Notice> : null}

      {codes ? (
        <div className="card mb-6 ring-gold">
          <h2 className="font-semibold">Your recovery codes</h2>
          <p className="muted mt-1 text-sm">Each code works once if you lose your phone or passkey. Save them somewhere safe now. They will not be shown again.</p>
          <ul className="mt-3 grid grid-cols-2 gap-1 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      ) : null}

      <section className="card">
        <h2 className="font-semibold">Two-factor sign-in</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {confirmed.filter((f) => f.type !== "RECOVERY_CODES").map((f) => (
            <li key={f.id} className="flex items-center justify-between">
              <span>{f.type === "TOTP" ? "Authenticator app" : `Passkey: ${f.label}`}{f.lastUsedAt ? `, last used ${manila.format(f.lastUsedAt)}` : ""}</span>
              <form action={removeFactorAction}><input type="hidden" name="id" value={f.id} /><button className="text-red-700 underline">Remove</button></form>
            </li>
          ))}
          {!has2fa ? <li className="muted">Not turned on.</li> : null}
        </ul>
        {setup && qr ? (
          <div className="mt-4 rounded-s bg-surface-muted p-4">
            <p className="text-sm">Scan this with Google Authenticator, Microsoft Authenticator or a similar app, then enter the 6-digit code.</p>
            <img src={qr} alt="QR code for your authenticator app" width={180} height={180} className="mt-3" />
            <p className="muted mt-2 font-mono text-xs break-all">Key: {decrypt(setup.secret)}</p>
            <form action={confirmTotpAction} className="mt-3 flex gap-2">
              <input type="hidden" name="factorId" value={setup.id} />
              <input className="input max-w-40" name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" aria-label="Code" required />
              <button className="btn">Turn on</button>
            </form>
          </div>
        ) : !confirmed.some((f) => f.type === "TOTP") ? (
          <form action={startTotpAction} className="mt-4"><button className="btn">Set up an authenticator app</button></form>
        ) : null}
        <div className="mt-6"><PasskeyRegister options={JSON.parse(JSON.stringify(passkeyOptions))} action={addPasskeyAction} /></div>
        {has2fa ? (
          <form action={newRecoveryCodesAction} className="mt-4 flex items-center gap-3 text-sm">
            <span className="muted">{left} recovery codes left.</span>
            <button className="underline">Make new recovery codes</button>
          </form>
        ) : null}
      </section>

      <section className="card mt-6">
        <h2 className="font-semibold">Password</h2>
        <form action={changePasswordAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input className="input" type="password" name="current" placeholder="Current password" autoComplete="current-password" required aria-label="Current password" />
          <input className="input" type="password" name="password" placeholder="New password (12+ characters)" autoComplete="new-password" required aria-label="New password" />
          <div><button className="btn">Change password</button></div>
        </form>
      </section>

      <section className="card mt-6">
        <h2 className="font-semibold">Where you are signed in</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {active.map((x) => (
            <li key={x.id} className="flex items-center justify-between">
              <span>{x.deviceLabel ?? "Unknown device"} · {x.ipAddress ?? "unknown address"} · last seen {manila.format(x.lastSeenAt)}{x.id === s.session.id ? " (this device)" : ""}</span>
              {x.id !== s.session.id ? <form action={endSessionAction}><input type="hidden" name="id" value={x.id} /><button className="underline">End</button></form> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
