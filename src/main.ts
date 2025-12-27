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
  const newValue = (previousValue ?? 0) + 1;
  map.set(key, newValue);
}

function decrement<T>(map: Map<T, number>, key: T) {
  const previousValue = map.get(key);
  const newValue = (previousValue ?? 0) - 1;
  map.set(key, newValue);
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
  #currentRunLength = 0;
  #differencesAfterRle = new Map<number, number>(
    count(-255, 256).map((difference) => [difference, 0])
  );
  #runLengths = new Map<number, number>();
  add(byte: number) {
    increment(this.#byteCounts, byte);
    if (this.#previousByte !== undefined) {
      const difference = byte - this.#previousByte;
      increment(this.#differenceCounts, difference);
      // RLE part:
      if (difference == 0) {
        if (this.#currentRunLength > 0) {
          decrement(this.#runLengths, this.#currentRunLength);
        }
        this.#currentRunLength++;
        increment(this.#runLengths, this.#currentRunLength);
      } else {
        this.#currentRunLength = 0;
      }
      if (this.#currentRunLength < 2) {
        increment(this.#differencesAfterRle, difference);
      }
    }
    this.#previousByte = byte;
  }
  get byteCounts(): ReadonlyMap<number, number> {
    return this.#byteCounts;
  }
  get differenceCounts(): ReadonlyMap<number, number> {
    return this.#differenceCounts;
  }
  get differencesAfterRle(): ReadonlyMap<number, number> {
    return this.#differencesAfterRle;
  }
  get runLengths(): ReadonlyMap<number, number> {
    return this.#runLengths;
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
  let optimisticRleCompressedSize = 0;
  let lessOptimisticRleCompressedSize = 0;
  let rleCompressedSize = 0;
  for (let [name, accumulator] of zip(channelNames, accumulators)) {
    const top = selectorQuery(`[data-color="${name}"]`, HTMLDivElement);
    function drawHistogram(
      selector: string,
      data: ReadonlyMap<number, number>
    ) {
      const container = selectorQuery(selector, SVGSVGElement, top);
      const element = makeHistogram(data)!; // TODO why do I have ! everywhere?  Fix the api?
      container.append(element);
    }
    function say(selector: string, text: string) {
      selectorQuery(selector, HTMLDivElement, top).innerHTML = text;
    }

    /**
     * Look at the frequency of the data without any filter.
     */
    const byteCost = EntropyEncoder.costFromMap(accumulator.byteCounts);
    positionCompressedSize += byteCost;
    drawHistogram('[data-content="bytes"]', accumulator.byteCounts);
    say(
      '[data-which="bytes"',
      `Number of 0’s: ${countZeros(
        accumulator.byteCounts
      )}. Cost in bytes: ${byteCost.toLocaleString()}`
    );

    /**
     * Basic preprocessing:  Subtract the previous value from the current value, then encode these differences.
     */
    const differenceCost = EntropyEncoder.costFromMap(
      accumulator.differenceCounts
    );
    differenceCompressedSize += differenceCost;
    drawHistogram('[data-content="differences"]', accumulator.differenceCounts);
    say(
      '[data-which="differences"',
      `Number of 0’s: ${countZeros(
        accumulator.differenceCounts
      )}. Cost in bytes: ${differenceCost.toLocaleString()}.`
    );

    /**
     * This is an upper bound on how much we can save from the RLE.
     *
     * RLE only looks at bytes where the difference between that byte and the previous byte is 0.
     * Assume all of these zero are all together and can be handled in one RLE instruction with fixed cost.
     */
    const optimisticRleCounts = new Map(accumulator.differenceCounts);
    optimisticRleCounts.set(0, 0);
    const optimisticRleCost = EntropyEncoder.costFromMap(optimisticRleCounts);
    optimisticRleCompressedSize += optimisticRleCost;
    drawHistogram('[data-content="optimistic-rle"]', optimisticRleCounts);
    say(
      '[data-which="optimistic-rle"',
      `Number of 0’s: ${countZeros(
        optimisticRleCounts
      )}. Cost in bytes: ${optimisticRleCost.toLocaleString()}.`
    );

    /**
     * A modified version of the differences, because we've removed the ones that were part of an RLE stream.
     */
    const rleDifferencesCost = EntropyEncoder.costFromMap(
      accumulator.differencesAfterRle
    );
    drawHistogram(
      '[data-content="rle-differences"]',
      accumulator.differencesAfterRle
    );
    /**
     * And then the cost of those runs.
     */
    const rleRunsCost = EntropyEncoder.costFromMap(accumulator.runLengths);
    if (accumulator.runLengths.size < 2000) {
      drawHistogram('[data-content="rle-lengths"]', accumulator.runLengths);
    }
    console.log(accumulator.runLengths);
    lessOptimisticRleCompressedSize += rleDifferencesCost;
    rleCompressedSize += rleDifferencesCost + rleRunsCost;
    say(
      '[data-which="rle"]',
      `Differences cost: ${rleDifferencesCost.toLocaleString()}, Runs cost: ${rleRunsCost.toLocaleString()}, Total cost in bytes: ${
        rleDifferencesCost + rleRunsCost
      }.`
    );
  }
  const uncompressedFileSize = imageData.data.length;
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
    ).toFixed(3)}% of PNG.`,
    document.createElement("br"),
    `Optimistic RLE compressed size: ${optimisticRleCompressedSize.toLocaleString()}, ${(
      (optimisticRleCompressedSize / uncompressedFileSize) *
      100
    ).toFixed(3)}% of uncompressed, ${(
      (optimisticRleCompressedSize / initialFileSize) *
      100
    ).toFixed(3)}% of PNG.`,
    document.createElement("br"),
    `Less optimistic RLE compressed size: ${lessOptimisticRleCompressedSize.toLocaleString()}, ${(
      (lessOptimisticRleCompressedSize / uncompressedFileSize) *
      100
    ).toFixed(3)}% of uncompressed, ${(
      (lessOptimisticRleCompressedSize / initialFileSize) *
      100
    ).toFixed(3)}% of PNG.`,
    document.createElement("br"),
    `RLE compressed size: ${rleCompressedSize.toLocaleString()}, ${(
      (rleCompressedSize / uncompressedFileSize) *
      100
    ).toFixed(3)}% of uncompressed, ${(
      (rleCompressedSize / initialFileSize) *
      100
    ).toFixed(3)}% of PNG.`
  );
}

loadFromUrl("./reference-images/Lenna.png");

(window as any).philDebug = { loadFromUrl, EntropyEncoder };
