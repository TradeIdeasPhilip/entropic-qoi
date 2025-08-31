import "./style.css";
import { selectorQuery } from "phil-lib/client-misc";
import {
  assertNonNullable,
  count,
  initializedArray,
  parseIntX,
  zip,
} from "phil-lib/misc";
import { EntropyEncoder } from "./entropy-encoder";
import { makeHistogram } from "./histogram";

const canvas = selectorQuery("canvas", HTMLCanvasElement);
const context = assertNonNullable(canvas.getContext("2d"));

async function loadFromUrl(url: string) {
  const imageElement = document.createElement("img");
  imageElement.src = url;
  await imageElement.decode();
  if (imageElement.naturalHeight == 0 || imageElement.naturalWidth == 0) {
    throw new Error(`Unable to load “${url}”`);
  }
  canvas.width = imageElement.naturalWidth;
  canvas.height = imageElement.naturalHeight;
  canvas.style.maxWidth = `${canvas.width / devicePixelRatio}px`;
  canvas.style.maxHeight = `${canvas.height / devicePixelRatio}px`;
  context.drawImage(imageElement, 0, 0);
  const fileSize = assertNonNullable(
    parseIntX(
      (await fetch(url, { method: "HEAD" })).headers.get("content-length")
    )
  );

  stats(context.getImageData(0, 0, canvas.width, canvas.height), fileSize);
}

function increment<T>(map: Map<T, number>, key: T) {
  const previousValue = map.get(key);
  if (previousValue === undefined) {
    throw new Error("unknown item");
  }
  map.set(key, previousValue + 1);
}

function countZeros<T>(map: ReadonlyMap<T, number>) {
  let result = 0;
  map.forEach((count) => {
    if (count == 0) {
      result++;
    }
  });
  return result;
}

class Accumulator {
  #previousByte: number | undefined;
  #byteCounts = new Map<number, number>(
    initializedArray(256, (byte) => [byte, 0])
  );
  #differenceCounts = new Map<number, number>(
    count(-255, 256).map((difference) => [difference, 0])
  );
  add(byte: number) {
    increment(this.#byteCounts, byte);
    if (this.#previousByte !== undefined) {
      const difference = byte - this.#previousByte;
      increment(this.#differenceCounts, difference);
    }
    this.#previousByte = byte;
  }
  get byteCounts(): ReadonlyMap<number, number> {
    return this.#byteCounts;
  }
  get differenceCounts(): ReadonlyMap<number, number> {
    return this.#differenceCounts;
  }
}

const channelNames = ["red", "green", "blue", "alpha"];

function stats(imageData: ImageData, initialFileSize: number) {
  const channelCount = channelNames.length;
  const accumulators = initializedArray(channelCount, () => new Accumulator());
  imageData.data.forEach((byte, index) => {
    const accumulator = accumulators[index % channelCount];
    accumulator.add(byte);
  });
  let positionCompressedSize = 0;
  let differenceCompressedSize = 0;
  for (let [name, accumulator] of zip(channelNames, accumulators)) {
    const byteCost = EntropyEncoder.costFromMap(accumulator.byteCounts);
    positionCompressedSize += byteCost;
    const differenceCost = EntropyEncoder.costFromMap(
      accumulator.differenceCounts
    );
    differenceCompressedSize += differenceCost;
    console.log(
      name,
      accumulator,
      countZeros(accumulator.byteCounts),
      byteCost.toLocaleString(),
      countZeros(accumulator.differenceCounts),
      differenceCost.toLocaleString()
    );
    {
      const top = selectorQuery(`[data-color="${name}"]`, HTMLDivElement);
      {
        const container = selectorQuery(
          '[data-content="bytes"]',
          SVGSVGElement,
          top
        );
        const element = makeHistogram(accumulator.byteCounts)!;
        container.append(element);
      }
      selectorQuery(
        '[data-which="bytes"',
        HTMLDivElement,
        top
      ).innerHTML = `Number of 0’s: ${countZeros(
        accumulator.byteCounts
      )}. Cost in bytes: ${byteCost.toLocaleString()}`;
      {
        const container = selectorQuery(
          '[data-content="differences"]',
          SVGSVGElement,
          top
        );
        const element = makeHistogram(accumulator.differenceCounts)!;
        container.append(element);
      }
      selectorQuery(
        '[data-which="differences"',
        HTMLDivElement,
        top
      ).innerHTML = `Number of 0’s: ${countZeros(
        accumulator.differenceCounts
      )}. Cost in bytes: ${differenceCost.toLocaleString()}.`;
    }
  }
  const uncompressedFileSize = imageData.data.length;
  console.log("uncompressed file size:", uncompressedFileSize);
  console.log(
    "initial file size:",
    initialFileSize,
    initialFileSize / uncompressedFileSize
  );
  console.log(
    "byte compressed size:",
    positionCompressedSize,
    positionCompressedSize / uncompressedFileSize,
    positionCompressedSize / initialFileSize
  );
  console.log(
    "difference compressed size:",
    differenceCompressedSize,
    differenceCompressedSize / uncompressedFileSize,
    differenceCompressedSize / initialFileSize
  );
  selectorQuery("#summary", HTMLDivElement).append(
    `Uncompressed file size: ${uncompressedFileSize.toLocaleString()}.`,
    document.createElement("br"),
    `Initial file size: ${initialFileSize.toLocaleString()}, ${(
      (initialFileSize / uncompressedFileSize) *
      100
    ).toFixed(3)}% of uncompressed.`,
    document.createElement("br"),
    `Byte compressed size: ${positionCompressedSize.toLocaleString()}, ${(
      (positionCompressedSize / uncompressedFileSize) *
      100
    ).toFixed(3)}% of uncompressed, ${(
      (positionCompressedSize / initialFileSize) *
      100
    ).toFixed(3)}% of PNG.`,
    document.createElement("br"),
    `Difference compressed size: ${differenceCompressedSize.toLocaleString()}, ${(
      (differenceCompressedSize / uncompressedFileSize) *
      100
    ).toFixed(3)}% of uncompressed, ${(
      (differenceCompressedSize / initialFileSize) *
      100
    ).toFixed(3)}% of PNG.`
  );
}

loadFromUrl("./reference-images/Laser Light Show.png");

(window as any).philDebug = { loadFromUrl, EntropyEncoder };
