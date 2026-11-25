import { bigint, boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, ts, updatedAt } from "./common";
import { organizations } from "./account";

const money = () => bigint({ mode: "number" }).notNull().default(0);

/** The selling entity (CR-02). Sentire is the only seller; tax status switches without code changes. */
export const sellerProfiles = pgTable("seller_profiles", {
  id: id(),
  code: text().notNull().unique(),
  registeredName: text().notNull(),
  tradeName: text(),
  tin: text().notNull(),
  branchCode: text().notNull().default("00000"),
  address: text().notNull(),
  taxStatus: text({ enum: ["VAT", "NON_VAT"] }).notNull().default("NON_VAT"),
  statementPrefix: text().notNull(),
  nextStatementNumber: integer().notNull().default(1),
  nextCreditNoteNumber: integer().notNull().default(1),
  bankDetails: text(),
  confirmed: boolean().notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const products = pgTable("products", {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  appId: text().notNull(),
  sellerProfileId: text().notNull().references(() => sellerProfiles.id),
  onSale: boolean().notNull().default(true),
  description: text(),
  createdAt: createdAt(),
});

export interface PlanLimits {
  users?: number | null;
  companies?: number | null;
  branches?: number | null;
  invoicesPerMonth?: number | null;
  [k: string]: number | null | undefined;
}

export const plans = pgTable(
  "plans",
  {
    id: id(),
    productId: text().notNull().references(() => products.id),
    code: text().notNull(),
    name: text().notNull(),
    rank: integer().notNull(),
    limits: jsonb().$type<PlanLimits>().notNull().default({}),
    allowsConnections: boolean().notNull().default(true),
    onSale: boolean().notNull().default(true),
    summary: text(),
    pilotDays: integer(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.productId, t.code)],
);

export const addOns = pgTable("add_ons", {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  productId: text().references(() => products.id), // null = any product
  minPlanRank: integer().notNull().default(0),
  limits: jsonb().$type<PlanLimits>().notNull().default({}),
  benefit: text(),
  onSale: boolean().notNull().default(true),
  createdAt: createdAt(),
});

/** Versioned prices: a change never alters a subscription before renewal (FR-13). */
export const prices = pgTable(
  "prices",
  {
    id: id(),
    planId: text().references(() => plans.id),
    addOnId: text().references(() => addOns.id),
    cycle: text({ enum: ["MONTHLY", "ANNUAL", "ONE_TIME"] }).notNull(),
    amountCentavos: money(),
    setupFeeCentavos: money(),
    validFrom: date().notNull(),
    validTo: date(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.planId), index().on(t.addOnId)],
);

export const meteredRates = pgTable("metered_rates", {
  id: id(),
  planId: text().references(() => plans.id),
  addOnId: text().references(() => addOns.id),
  meter: text().notNull(),
  includedUnits: integer().notNull().default(0),
  centavosPerUnit: integer().notNull(),
});

/** Paywall: feature catalog (FR-44). Keys are permanent. */
export const features = pgTable("features", {
  key: text().primaryKey(),
  name: text().notNull(),
  benefit: text().notNull(),
  productCode: text(), // null = across apps
  limitUnit: text(), // e.g. "requests a month"
  createdAt: createdAt(),
});

export const featureGrants = pgTable(
  "feature_grants",
  {
    id: id(),
    featureKey: text().notNull().references(() => features.key),
    planId: text().references(() => plans.id),
    addOnId: text().references(() => addOns.id),
    limit: integer(),
    limitMode: text({ enum: ["SOFT", "HARD", "OVERAGE"] }).notNull().default("HARD"),
    overageMeter: text(),
  },
  (t) => [index().on(t.featureKey)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    organizationId: text().notNull().references(() => organizations.id),
    productId: text().notNull().references(() => products.id),
    planId: text().notNull().references(() => plans.id),
    status: text({ enum: ["PENDING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED"] }).notNull().default("PENDING"),
    cycle: text({ enum: ["MONTHLY", "ANNUAL"] }).notNull(),
    anchorDay: integer().notNull().default(1),
    currentPeriodStart: date(),
    currentPeriodEnd: date(), // exclusive: the next period starts on this date
    cancelAtPeriodEnd: boolean().notNull().default(false),
    scheduledPlanId: text(),
    scheduledCycle: text({ enum: ["MONTHLY", "ANNUAL"] }),
    scheduledAddOnIds: jsonb().$type<string[]>(),
    pastDueSince: date(),
    graceUntil: date(),
    suspendedAt: ts(),
    cancelledAt: ts(),
    endedReason: text(),
    paymentMethodId: text(),
    pilotUntil: date(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.organizationId), index().on(t.status, t.currentPeriodEnd)],
);

export const subscriptionItems = pgTable(
  "subscription_items",
  {
    id: id(),
    organizationId: text().notNull(),
    subscriptionId: text().notNull().references(() => subscriptions.id),
    kind: text({ enum: ["PLAN", "ADD_ON"] }).notNull(),
    priceId: text().notNull().references(() => prices.id),
    addOnId: text(),
    quantity: integer().notNull().default(1),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.subscriptionId)],
);

export const billingStatements = pgTable(
  "billing_statements",
  {
    id: id(),
    organizationId: text().notNull().references(() => organizations.id),
    sellerProfileId: text().notNull().references(() => sellerProfiles.id),
    subscriptionId: text().references(() => subscriptions.id),
    number: text().notNull(),
    kind: text({ enum: ["INITIAL", "RENEWAL", "CHANGE", "ADJUSTMENT"] }).notNull(),
    issueDate: date().notNull(),
    dueDate: date().notNull(),
    periodStart: date(),
    periodEnd: date(),
    status: text({ enum: ["OPEN", "PARTIALLY_PAID", "PAID", "VOID"] }).notNull().default("OPEN"),
    subtotalCentavos: money(),
    taxCentavos: money(),
    totalCentavos: money(),
    paidCentavos: money(),
    withheldCentavos: money(),
    creditedCentavos: money(),
    sellerSnapshot: jsonb().notNull(),
    buyerSnapshot: jsonb().notNull(),
    birInvoiceNumber: text(),
    birInvoiceRecordedAt: ts(),
    voidReason: text(),
    paidAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.sellerProfileId, t.number), index().on(t.organizationId, t.issueDate), index().on(t.status, t.dueDate)],
);

/** Append-only. */
export const statementLines = pgTable(
  "statement_lines",
  {
    id: id(),
    statementId: text().notNull().references(() => billingStatements.id),
    organizationId: text().notNull(),
    kind: text({ enum: ["SETUP_FEE", "PLAN", "ADD_ON", "USAGE", "PRORATION", "ADJUSTMENT"] }).notNull(),
    description: text().notNull(),
    quantity: integer().notNull().default(1),
    unitCentavos: bigint({ mode: "number" }).notNull(),
    amountCentavos: bigint({ mode: "number" }).notNull(),
    servicePeriodStart: date(),
    servicePeriodEnd: date(),
    priceId: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.statementId)],
);

/** Attempts at online payment. A Payment row exists only once money is confirmed. */
export const checkoutSessions = pgTable(
  "checkout_sessions",
  {
    id: id(),
    organizationId: text().notNull(),
    statementId: text().notNull().references(() => billingStatements.id),
    provider: text().notNull(),
    providerRef: text(),
    amountCentavos: bigint({ mode: "number" }).notNull(),
    url: text(),
    status: text({ enum: ["PENDING", "PAID", "FAILED", "EXPIRED"] }).notNull().default("PENDING"),
    returnUrl: text(),
    withholdingAtc: text(),
    withholdingBasisPoints: integer(),
    withholdingCentavos: bigint({ mode: "number" }),
    paywallFeature: text(),
    createdBy: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.statementId), uniqueIndex().on(t.provider, t.providerRef)],
);

/** Append-only (refunds are new rows with negative amounts). */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    organizationId: text().notNull(),
    statementId: text().notNull().references(() => billingStatements.id),
    method: text({ enum: ["CARD", "GCASH", "MAYA", "BANK_TRANSFER", "CASH", "CREDIT", "TEST"] }).notNull(),
    provider: text(),
    providerRef: text(),
    amountCentavos: bigint({ mode: "number" }).notNull(),
    kind: text({ enum: ["PAYMENT", "REFUND"] }).notNull().default("PAYMENT"),
    idempotencyKey: text().notNull(),
    reference: text(),
    recordedBy: text(),
    paidAt: ts().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.idempotencyKey), index().on(t.statementId)],
);

export const paymentMethods = pgTable("payment_methods", {
  id: id(),
  organizationId: text().notNull(),
  provider: text().notNull(),
  tokenRef: text().notNull(),
  label: text().notNull(),
  isDefault: boolean().notNull().default(false),
  createdAt: createdAt(),
});

/** Creditable withholding on a payment (FR-19, CR-03). */
export const withholdings = pgTable(
  "withholdings",
  {
    id: id(),
    organizationId: text().notNull(),
    statementId: text().notNull().references(() => billingStatements.id),
    paymentId: text(),
    atc: text().notNull(),
    rateBasisPoints: integer().notNull(),
    amountCentavos: bigint({ mode: "number" }).notNull(),
    quarter: text().notNull(), // 2026-Q4
    status: text({ enum: ["PENDING", "RECEIVED", "REJECTED", "BILLED"] }).notNull().default("PENDING"),
    certificateKey: text(),
    certificateName: text(),
    uploadedAt: ts(),
    reviewedBy: text(),
    reviewedAt: ts(),
    reason: text(),
    remindedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.organizationId), index().on(t.status, t.quarter)],
);

/** Append-only. */
export const creditNotes = pgTable("credit_notes", {
  id: id(),
  organizationId: text().notNull(),
  statementId: text().notNull().references(() => billingStatements.id),
  number: text().notNull().unique(),
  amountCentavos: bigint({ mode: "number" }).notNull(),
  reason: text().notNull(),
  createdBy: text().notNull(),
  createdAt: createdAt(),
});

export const dunningSteps = pgTable(
  "dunning_steps",
  {
    id: id(),
    subscriptionId: text().notNull().references(() => subscriptions.id),
    statementId: text().notNull(),
    dayOffset: integer().notNull(),
    action: text({ enum: ["REMIND", "SUSPEND", "CANCEL"] }).notNull(),
    doneAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.statementId, t.dayOffset)],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text().notNull(),
    eventId: text().notNull(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    processedAt: ts(),
    error: text(),
    receivedAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.provider, t.eventId)],
);

/** Files (statement PDFs are generated on request; 2307 uploads and exports are stored). */
export const files = pgTable("files", {
  id: id(),
  organizationId: text(),
  purpose: text().notNull(),
  name: text().notNull(),
  contentType: text().notNull(),
  bytes: integer().notNull(),
  storageKey: text().notNull(),
  createdBy: text(),
  createdAt: createdAt(),
});
