import { env } from "@/lib/env";
import { formatPHP } from "@/lib/money";

type St = { id: string; number: string; totalCentavos: number; dueDate: string; organizationId: string; kind: string };
type Org = { registeredName: string; tradeName: string | null };

const link = (p: string) => env().APP_URL.replace(/\/$/, "") + p;
const sign = "\n\nSentire Cloud billing\nThis is a billing statement, not a BIR invoice. Sentire issues the invoice when payment is received.";

export const billingMails = {
  statement: (st: St, org: Org) => ({
    template: "statement",
    subject: `Billing statement ${st.number}: ${formatPHP(st.totalCentavos)} due ${st.dueDate}`,
    text: `Hello ${org.tradeName ?? org.registeredName},\n\nBilling statement ${st.number} for ${formatPHP(st.totalCentavos)} is due on ${st.dueDate}.\n\nView and pay: ${link(`/org/billing/statements/${st.id}`)}${sign}`,
  }),
  receipt: (st: St, amount: number, org: Org) => ({
    template: "receipt",
    subject: `Payment received for ${st.number}`,
    text: `Hello ${org.tradeName ?? org.registeredName},\n\nWe received ${formatPHP(amount)} for billing statement ${st.number}. Thank you.\n\nStatement: ${link(`/org/billing/statements/${st.id}`)}${sign}`,
  }),
  reminder: (st: St, org: Org, day: number) => ({
    template: "dunning-reminder",
    subject: `Payment overdue: ${st.number}`,
    text: `Hello ${org.tradeName ?? org.registeredName},\n\nBilling statement ${st.number} for ${formatPHP(st.totalCentavos)} was due on ${st.dueDate} and is still unpaid (day ${day}).\n\nIf it stays unpaid, your apps become read-only on day 8 and the subscription is cancelled on day 30.\n\nPay now: ${link(`/org/billing/statements/${st.id}`)}${sign}`,
  }),
  suspended: (st: St, org: Org) => ({
    template: "dunning-suspended",
    subject: `Your Sentire apps are read-only: ${st.number} is unpaid`,
    text: `Hello ${org.tradeName ?? org.registeredName},\n\nBecause billing statement ${st.number} is unpaid, your Sentire apps are now read-only. Your data is safe and you can still sign in and read it.\n\nPaying the balance restores full access at once: ${link(`/org/billing/statements/${st.id}`)}\n\nIf it stays unpaid for 30 days from the due date, the subscription is cancelled.${sign}`,
  }),
  cancelled: (org: Org, productName: string) => ({
    template: "subscription-cancelled",
    subject: `Your ${productName} subscription has ended`,
    text: `Hello ${org.tradeName ?? org.registeredName},\n\nYour ${productName} subscription has ended. Your Owner can download a full export of your data from the billing page for 30 days.${sign}`,
  }),
  withholdingReminder: (org: Org, quarter: string, amount: number) => ({
    template: "2307-reminder",
    subject: `BIR Form 2307 needed for ${quarter}`,
    text: `Hello ${org.tradeName ?? org.registeredName},\n\nYou withheld ${formatPHP(amount)} on payments to Sentire in ${quarter}. Please upload the signed BIR Form 2307: ${link("/org/billing")}${sign}`,
  }),
};
