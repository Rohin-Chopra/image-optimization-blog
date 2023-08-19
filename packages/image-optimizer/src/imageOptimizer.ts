import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { S3Event } from "aws-lambda";
import sharp from "sharp";
import type { Readable } from "stream";

type ImageSizeVariant = "sm" | "md" | "lg" | "xl" | "2xl";

interface ImageDimensions {
  width: number;
}

export class ImageOptimizer {
  #s3Client: S3Client;
  #imageDimensions: Map<ImageSizeVariant, ImageDimensions>;

  constructor() {
    this.#s3Client = new S3Client({ region: process.env.AWS_REGION });
    this.#imageDimensions = new Map<ImageSizeVariant, ImageDimensions>([
      ["sm", { width: 640 }],
      ["md", { width: 768 }],
      ["lg", { width: 1024 }],
      ["xl", { width: 1280 }],
      ["2xl", { width: 1536 }],
    ]);
  }

  async #getObjectFromS3(
    objectKey: string,
    bucketName: string
  ): Promise<Buffer> {
    console.log(`Getting object from S3: ${bucketName}/${objectKey}`);

    const { Body } = await this.#s3Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      })
    );
    const stream = Body as Readable;

    const dataChunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      stream.on("data", (chunk) => dataChunks.push(chunk));

      stream.on("error", (err) => {
        console.error(`Error fetching object from S3: ${err}`);
        reject(err);
      });

      stream.on("end", () => resolve(Buffer.concat(dataChunks)));
    });
  }

  async #resizeImage(
    image: sharp.Sharp,
    metadata: sharp.Metadata,
    { width }: ImageDimensions
  ): Promise<Buffer> {
    console.log(`Resizing image to width: ${width}`);

    if (!metadata.width || metadata.width > width) {
      image.resize({
        width,
        fit: "contain",
      });
    }

    switch (metadata.format) {
      case "jpeg":
      case "jpg":
        image.toFormat(metadata.format, {
          mozjpeg: true,
        });
        break;
      case "png":
        image.toFormat("png", { quality: 90 });
        break;
      default:
        throw new Error("Unsupported image provided");
    }

    return await image.toBuffer();
  }

  public async handler(event: S3Event) {
    const [record] = event.Records;
    const bucketName = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

    const originalBuffer = await this.#getObjectFromS3(key, bucketName);

    const image = sharp(originalBuffer);
    const metadata = await image.metadata();

    for await (const [size, dimensions] of this.#imageDimensions) {
      const [prefix, extension] = key.split(".");
      if (!extension) {
        throw new Error("No image extension provided");
      }

      const resizedImage = await this.#resizeImage(image, metadata, dimensions);

      await this.#s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.OUTPUT_S3_BUCKET_NAME,
          Key: `${prefix}-${size}.${extension}`,
          Body: resizedImage,
        })
      );

      console.log(
        `Resized image uploaded to S3: ${prefix}-${size}.${extension}`
      );
    }
  }
}
