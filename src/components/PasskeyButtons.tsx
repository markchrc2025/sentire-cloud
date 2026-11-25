"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useRef, useState } from "react";

export function PasskeySignIn({ options, next, action }: { options: Parameters<typeof startAuthentication>[0]["optionsJSON"]; next: string; action: (fd: FormData) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form ref={formRef} action={action} className="mb-5">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="passkey" ref={ref} />
      <button
        type="button"
        className="btn-secondary w-full"
        onClick={async () => {
          try {
            const r = await startAuthentication({ optionsJSON: options });
            ref.current!.value = JSON.stringify(r);
            formRef.current!.requestSubmit();
          } catch {
            setErr("The passkey did not work. Use a code instead.");
          }
        }}
      >
        Use a passkey
      </button>
      {err ? <p className="mt-2 text-sm text-red-700">{err}</p> : null}
    </form>
  );
}

export function PasskeyRegister({ options, action }: { options: Parameters<typeof startRegistration>[0]["optionsJSON"]; action: (fd: FormData) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form ref={formRef} action={action} className="flex items-end gap-2">
      <input type="hidden" name="response" ref={ref} />
      <div className="flex-1">
        <label className="label" htmlFor="label">Passkey name</label>
        <input className="input" id="label" name="label" placeholder="Work laptop" />
      </div>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          try {
            const r = await startRegistration({ optionsJSON: options });
            ref.current!.value = JSON.stringify(r);
            formRef.current!.requestSubmit();
          } catch {
            setErr("The passkey was not added.");
          }
        }}
      >
        Add passkey
      </button>
      {err ? <p className="mt-2 text-sm text-red-700">{err}</p> : null}
    </form>
  );
}
