// Money is integer centavos, currency PHP. Never floating point.

export type Centavos = number;

export function assertCentavos(v: number): Centavos {
  if (!Number.isSafeInteger(v)) throw new Error(`Not a whole number of centavos: ${v}`);
  return v;
}

/** Multiply centavos by a rational (num/den), rounding half up (away from zero for negatives). */
export function mulDiv(amount: Centavos, num: number, den: number): Centavos {
  if (den === 0) throw new Error("Division by zero");
  const a = BigInt(assertCentavos(amount)) * BigInt(num);
  const d = BigInt(den);
  const neg = (a < 0n) !== (d < 0n);
  const absA = a < 0n ? -a : a;
  const absD = d < 0n ? -d : d;
  const q = (absA * 2n + absD) / (absD * 2n);
  return Number(neg ? -q : q);
}

/** Percentage in basis points (200 = 2%), half-up. */
export function percent(amount: Centavos, basisPoints: number): Centavos {
  return mulDiv(amount, basisPoints, 10000);
}

export function sum(values: Centavos[]): Centavos {
  return values.reduce((a, b) => a + assertCentavos(b), 0);
}

export function formatPHP(amount: Centavos): string {
  const neg = amount < 0;
  const abs = Math.abs(amount);
  const pesos = Math.floor(abs / 100).toLocaleString("en-PH");
  const cents = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}PHP ${pesos}.${cents}`;
}

/** Parse "1,234.50" or "1234.5" into centavos. Throws on more than 2 decimals. */
export function parsePHP(text: string): Centavos {
  const t = text.replace(/[,\sPHP₱]/gi, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) throw new Error(`Not an amount: ${text}`);
  const [whole, frac = ""] = t.replace("-", "").split(".");
  const v = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return t.startsWith("-") ? -v : v;
}
