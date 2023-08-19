import type { S3Event } from "aws-lambda";
import { ImageOptimizer } from "./imageOptimizer.js";

const imageOptimizer = new ImageOptimizer();

export const handler = (event: S3Event) => imageOptimizer.handler(event);
