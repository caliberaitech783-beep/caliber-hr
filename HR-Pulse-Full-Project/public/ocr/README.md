# Free on-device Aadhaar OCR

The app uses the official `@paddleocr/paddleocr-js` 0.4.2 SDK, Apache-2.0.
Detection: PP-OCRv5_mobile_det. Recognition: en_PP-OCRv5_mobile_rec.
PaddleOCR source and license: https://github.com/PaddlePaddle/PaddleOCR

These unmodified ONNX model archives are bundled with the existing static site:

- `PP-OCRv5_mobile_det.tar`: SHA256 `781056046c9ed77a15c94681605db6a0f62317c2e9cce6931c71da2478d4bc30`
- `en_PP-OCRv5_mobile_rec.tar`: SHA256 `4424e851309b291b00aab8191cd4314cefbd2d1b2381ff8994019d262fa95e28`

Source URLs:

- https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar
- https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/en_PP-OCRv5_mobile_rec_onnx_infer.tar

The build/dev preparation script copies ONNX runtime assets from the locked dependency.
Model downloads and WASM requests use this site's origin. Recognition runs in
the browser's official PaddleOCR worker, using CPU/WASM with one thread.
No OCR API key, paid inference endpoint, new server or subscription is used.
Normal browser downloads use the site's existing hosting bandwidth allowance.
The website remains on Azure Static Web Apps Free; do not upgrade the plan or
introduce a hosted OCR fallback without the user's authorization.

First use downloads the model/runtime assets. Existing browser caching applies.
Images are not sent to an OCR provider. The app's existing joining-document
storage/submission behavior is independent of this recognition step.

Names, dates and addresses still need human verification, especially on tiny or
blurred scans. No name-specific spelling substitutions are built into the model.
