import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { S3Event } from "aws-lambda";
import sharp from "sharp";
import { Readable } from "stream";

const s3Client = new S3Client({ region: process.env.AWS_REGION });

async function getObjectFromS3(
  objectKey: string,
  bucketName: string
): Promise<Buffer> {
  const { Body } = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
    })
  );
  const stream = Body as Readable;

  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => chunks.push(chunk));

    stream.on("error", (err) => reject(err));

    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export async function handler(event: S3Event): Promise<void> {
  const [record] = event.Records;
  const bucketName = record.s3.bucket.name;
  const inputImageKey = decodeURIComponent(
    record.s3.object.key.replace(/\+/g, " ")
  );

  const inputImageBuffer = await getObjectFromS3(inputImageKey, bucketName);

  const sharpImage = sharp(inputImageBuffer);
  const imageExtension = (await sharpImage.metadata()).format;

  let resizedImageBuffer: Buffer | undefined;

  if (imageExtension && ["jpeg", "jpg"].includes(imageExtension)) {
    resizedImageBuffer = await sharpImage
      .toFormat(imageExtension, {
        mozjpeg: true,
      })
      .toBuffer();
  } else if (imageExtension === "png") {
    resizedImageBuffer = await sharpImage
      .toFormat("png", { quality: 80 })
      .toBuffer();
  }

  if (!resizedImageBuffer) throw new Error("Unsupported image format");

  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.OUTPUT_S3_BUCKET_NAME,
      Key: inputImageKey,
      Body: resizedImageBuffer,
    })
  );
}
