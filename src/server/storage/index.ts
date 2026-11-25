import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/client";
import { files } from "../db/schema";
import { newId } from "@/lib/ids";

/** RustFS (S3-compatible) when configured; a local folder in development and tests. Files are private. */
function s3() {
  const { S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  return new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION || "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
  });
}

const LOCAL = path.resolve(process.cwd(), ".data/files");

export async function putFile(input: { organizationId: string | null; purpose: string; name: string; contentType: string; body: Buffer; createdBy?: string | null }) {
  const key = `${input.purpose}/${input.organizationId ?? "platform"}/${newId()}-${input.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  const client = s3();
  if (client) await client.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: input.body, ContentType: input.contentType }));
  else {
    await mkdir(path.dirname(path.join(LOCAL, key)), { recursive: true });
    await writeFile(path.join(LOCAL, key), input.body);
  }
  const [f] = await db()
    .insert(files)
    .values({ organizationId: input.organizationId, purpose: input.purpose, name: input.name, contentType: input.contentType, bytes: input.body.length, storageKey: key, createdBy: input.createdBy ?? null })
    .returning();
  return f!;
}

export async function getFileBody(storageKey: string): Promise<Buffer> {
  const client = s3();
  if (!client) return readFile(path.join(LOCAL, storageKey));
  const r = await client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: storageKey }));
  return Buffer.from(await r.Body!.transformToByteArray());
}
