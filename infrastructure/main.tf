terraform {
  required_version = "~> 1.4.0"

  required_providers {
    aws = "~> 5.12.0"
  }
}

provider "aws" {
  region = "ap-southeast-2"
}

resource "aws_s3_bucket" "input_bucket" {
  bucket = "image-optimization-input-bucket"
}

resource "aws_s3_bucket" "output_bucket" {
  bucket = "image-optimiation-output-bucket" # Todo: fix name typo
}

resource "aws_s3_bucket_notification" "input_bucket_notification" {
  bucket = aws_s3_bucket.input_bucket.id

  lambda_function {
    lambda_function_arn = module.image_optimizer_lambda.lambda_function_arn
    events              = ["s3:ObjectCreated:*"]
  }

  depends_on = [aws_lambda_permission.allow_bucket_invoke_lambda]
}

module "sharp_lambda_layer" {
  source = "terraform-aws-modules/lambda/aws"

  create_layer = true

  layer_name          = "sharp-lambda-layer"
  compatible_runtimes = ["nodejs16.x", "nodejs18.x"]

  source_path = [
    {
      path = "${path.module}/../packages/lambda-layers/sharp/nodejs",
      commands = [
        "SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm ci --arch=x64 --platform=linux --libc=glibc sharp",
        "cd ..",
        ":zip"
      ]
    }
  ]
}

module "image_optimizer_lambda" {
  source = "terraform-aws-modules/lambda/aws"

  function_name = "image-optimizer-lambda"
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  memory_size   = 2000
  timeout       = 60
  environment_variables = {
    OUTPUT_S3_BUCKET_NAME = aws_s3_bucket.output_bucket.id
  }

  source_path = [
    {
      path = "${path.module}/../packages/image-optimizer"
      commands = [
        "npm ci",
        "npm run build",
        "cd .esbuild",
        ":zip"
      ]
    }
  ]

  layers = [module.sharp_lambda_layer.lambda_layer_arn]

  attach_policy_statements = true
  policy_statements = {
    input_bucket = {
      effect    = "Allow"
      actions   = ["s3:GetObject"]
      resources = [aws_s3_bucket.input_bucket.arn, "${aws_s3_bucket.input_bucket.arn}/*"]
    }

    output_bucket = {
      effect    = "Allow"
      actions   = ["s3:PutObject"]
      resources = [aws_s3_bucket.output_bucket.arn, "${aws_s3_bucket.output_bucket.arn}/*"]
    }
  }
}

resource "aws_lambda_permission" "allow_bucket_invoke_lambda" {
  statement_id  = "AllowExecutionFromS3Bucket"
  action        = "lambda:InvokeFunction"
  function_name = module.image_optimizer_lambda.lambda_function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.input_bucket.arn
}
