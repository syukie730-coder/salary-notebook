# 同梱した無料の文字読み取りライブラリ

このフォルダは給与明細の日本語と数字を**端末内で**読み取るための静的ファイルです。API キー、外部 OCR サービス、課金処理は使用しません。アプリと同じ GitHub Pages からファイルを取得します。明細画像や読み取り結果を送信するためのファイルではありません。

## 固定したバージョンと取得元

| ファイル | 取得元 | ライセンス |
| --- | --- | --- |
| `tesseract.min.js`, `worker.min.js` | [Tesseract.js 6.0.1](https://github.com/naptha/tesseract.js/tree/v6.0.1), npm 公開 tarball | Apache-2.0 と同梱の第三者表記 |
| `core/tesseract-core-lstm.wasm.js`, `core/tesseract-core-simd-lstm.wasm.js` | [tesseract.js-core 6.0.0](https://github.com/naptha/tesseract.js-core/tree/v6.0.0), npm 公開 tarball | Apache-2.0 |
| `lang/jpn.traineddata.gz`, `lang/eng.traineddata.gz` | [tessdata_fast 4.1.0](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0) | Apache-2.0 |

言語データは公式の `.traineddata` ファイルを内容を変更せず gzip 圧縮しています。ライセンス文は `licenses/` と各 `.LICENSE.txt` に同梱しています。配布 JavaScript は変更していません。

## 構成について

- `createWorker('jpn+eng', 1, …)` の LSTM 専用モードで使用します。
- `legacyCore` / `legacyLang` を有効にしたり、OEM を 0 / 2 に変更しないでください。
- [6.0.1 の core 選択処理](https://github.com/naptha/tesseract.js/blob/v6.0.1/src/worker-script/browser/getCore.js) に従い、SIMD 対応・非対応の両方を同梱しています。アプリが使用しない旧式エンジンの 2 種類は省いています。
- この配布版の `.wasm.js` は WebAssembly 本体を内包しています。別の `.wasm` ファイルは使わないため同梱していません。
- `workerPath`、`corePath`、`langPath` をアプリと同じ場所の絶対 URL にし、外部 CDN の既定値に任せない構成にしています。
- `workerBlobURL: false`、`cacheMethod: 'none'` を使用できます。オフライン用のファイルキャッシュはアプリの Service Worker が担当します。
- 日本語の縦書き認識および `worker.detect()` は対象外です。給与明細は文字が横向きになるよう撮影します。

両 core で日本語 + 英語データの初期化が成功することを確認しています。写真のぼけ、影、用紙のレイアウトにより読み取り間違いがあるため、保存前の数字の確認は必要です。
