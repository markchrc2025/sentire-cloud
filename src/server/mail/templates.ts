import { env } from "@/lib/env";

const sign = "\n\nSentire Cloud\nhttps://sentire.solutions";

function link(path: string) {
  return env().APP_URL.replace(/\/$/, "") + path;
}

export const templates = {
  verify: (name: string, token: string) => ({
    template: "verify",
    subject: "Confirm your email for Sentire Cloud",
    text: `Hi ${name},\n\nConfirm your email to finish creating your Sentire Account:\n${link(`/verify?token=${token}`)}\n\nThe link works for 24 hours. If you did not sign up, ignore this email.${sign}`,
  }),
  reset: (name: string, token: string) => ({
    template: "reset",
    subject: "Reset your Sentire Cloud password",
    text: `Hi ${name},\n\nUse this link to choose a new password:\n${link(`/reset?token=${token}`)}\n\nThe link works for 1 hour. If you did not ask for this, ignore this email; your password stays the same.${sign}`,
  }),
  invite: (orgName: string, inviter: string, token: string) => ({
    template: "invite",
    subject: `${inviter} invited you to ${orgName} on Sentire Cloud`,
    text: `Hello,\n\n${inviter} invited you to join ${orgName} on Sentire Cloud.\n\nAccept the invitation:\n${link(`/invite?token=${token}`)}\n\nThe invitation works for 7 days.${sign}`,
  }),
  newSignIn: (name: string, device: string, ip: string) => ({
    template: "new-sign-in",
    subject: "New sign-in to your Sentire Account",
    text: `Hi ${name},\n\nYour Sentire Account was signed in on ${device} (${ip}).\n\nIf this was not you, reset your password now: ${link("/forgot")}${sign}`,
  }),
  locked: (name: string) => ({
    template: "locked",
    subject: "Your Sentire Account is locked for 15 minutes",
    text: `Hi ${name},\n\nThere were too many failed sign-in attempts, so your account is locked for 15 minutes.\n\nIf this was not you, reset your password: ${link("/forgot")}${sign}`,
  }),
};
