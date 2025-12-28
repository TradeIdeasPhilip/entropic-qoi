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
import { MruList } from "./mru-list";

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
  #byteMruList = MruList.bytes();
  #mruByteCounts = new Map<number, number>(
    initializedArray(256, (byte) => [byte, 0])
  );
  #differenceMruList = MruList.diffs();
  #mruDifferenceCounts = new Map<number, number>(
    initializedArray(511, (index) => [index, 0])
  );
  #doubleDifferenceCounts = new Map<number, number>(
    count(-255, 256).map((difference) => [difference, 0])
  );
  #doubleDifferenceMruList = MruList.diffs();
  #mruDoubleDifferenceCounts = new Map<number, number>(
    initializedArray(511, (index) => [index, 0])
  );
  add(byte: number, byteAbove: number | undefined) {
    increment(this.#byteCounts, byte);
    increment(this.#mruByteCounts, this.#byteMruList.encode(byte));
    if (this.#previousByte !== undefined) {
      const difference = byte - this.#previousByte;
      increment(this.#differenceCounts, difference);
      increment(
        this.#mruDifferenceCounts,
        this.#differenceMruList.encode(difference)
      );
      {
        const doubleDifference =
          byteAbove === undefined
            ? difference
            : byte - Math.floor((this.#previousByte + byteAbove) / 2);
        increment(this.#doubleDifferenceCounts, doubleDifference);
        increment(
          this.#mruDoubleDifferenceCounts,
          this.#doubleDifferenceMruList.encode(doubleDifference)
        );
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
  get doubleDifferenceCounts(): ReadonlyMap<number, number> {
    return this.#doubleDifferenceCounts;
  }
  get mruByteCounts(): ReadonlyMap<number, number> {
    return this.#mruByteCounts;
  }
  get mruDifferenceCounts(): ReadonlyMap<number, number> {
    return this.#mruDifferenceCounts;
  }
  get mruDoubleDifferenceCounts(): ReadonlyMap<number, number> {
    return this.#mruDoubleDifferenceCounts;
  }
}

const channelNames = ["red", "green", "blue", "alpha"];

function stats(imageData: ImageData, initialFileSize: number) {
  const channelCount = channelNames.length;
  const accumulators = initializedArray(channelCount, () => new Accumulator());
  const oneRowUp = imageData.width * channelCount;
  imageData.data.forEach((byte, index, array) => {
    const accumulator = accumulators[index % channelCount];
    const indexAbove = index - oneRowUp;
    const byteAbove = array[indexAbove] as number | undefined;
    accumulator.add(byte, byteAbove);
  });
  let positionCompressedSize = 0;
  let differenceCompressedSize = 0;
  let doubleDifferenceCompressedSize = 0;
  let mruPositionCompressedSize = 0;
  let mruDifferenceCompressedSize = 0;
  let mruDoubleDifferenceCompressedSize = 0;
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
     * More preprocessing:  If we are not on the top row, take the average of the previous pixel and the pixel above.
     * Subtract that value from the current value, then encode these differences.
     */
    const doubleDifferenceCost = EntropyEncoder.costFromMap(
      accumulator.doubleDifferenceCounts
    );
    doubleDifferenceCompressedSize += doubleDifferenceCost;
    drawHistogram(
      '[data-content="double-differences"]',
      accumulator.doubleDifferenceCounts
    );
    say(
      '[data-which="double-differences"',
      `Number of 0’s: ${countZeros(
        accumulator.doubleDifferenceCounts
      )}. Cost in bytes: ${doubleDifferenceCost.toLocaleString()}.`
    );

    /**
     *
     */
    const mruByteCost = EntropyEncoder.costFromMap(accumulator.mruByteCounts);
    mruPositionCompressedSize += mruByteCost;
    drawHistogram('[data-content="mru-bytes"]', accumulator.mruByteCounts);
    say(
      '[data-which="mru-bytes"',
      `Number of 0’s: ${countZeros(
        accumulator.mruByteCounts
      )}. Cost in bytes: ${mruByteCost.toLocaleString()}`
    );

    /**
     * .
     */
    const mruDifferenceCost = EntropyEncoder.costFromMap(
      accumulator.mruDifferenceCounts
    );
    mruDifferenceCompressedSize += mruDifferenceCost;
    drawHistogram(
      '[data-content="mru-differences"]',
      accumulator.mruDifferenceCounts
    );
    say(
      '[data-which="mru-differences"',
      `Number of 0’s: ${countZeros(
        accumulator.mruDifferenceCounts
      )}. Cost in bytes: ${mruDifferenceCost.toLocaleString()}.`
    );

    /**
     * More preprocessing:  If we are not on the top row, take the average of the previous pixel and the pixel above.
     * Subtract that value from the current value, then encode these differences.
     * Then apply the MRU list encoding.
     */
    const mruDoubleDifferenceCost = EntropyEncoder.costFromMap(
      accumulator.mruDoubleDifferenceCounts
    );
    mruDoubleDifferenceCompressedSize += mruDoubleDifferenceCost;
    drawHistogram(
      '[data-content="mru-double-differences"]',
      accumulator.mruDoubleDifferenceCounts
    );
    say(
      '[data-which="mru-double-differences"',
      `Number of 0’s: ${countZeros(
        accumulator.mruDoubleDifferenceCounts
      )}. Cost in bytes: ${mruDoubleDifferenceCost.toLocaleString()}.`
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
    `Double difference compressed size: ${doubleDifferenceCompressedSize.toLocaleString()}, ${(
      (doubleDifferenceCompressedSize / uncompressedFileSize) *
      100
    ).toFixed(3)}% of uncompressed, ${(
      (doubleDifferenceCompressedSize / initialFileSize) *
      100
    ).toFixed(3)}% of PNG.`,
    document.createElement("br"),
    `MRU encoded byte compressed size: ${mruPositionCompressedSize.toLocaleString()}, ${(
      (mruPositionCompressedSize / uncompressedFileSize) *
      100
    ).toFixed(3)}% of uncompressed, ${(
      (mruPositionCompressedSize / initialFileSize) *
      100
    ).toFixed(3)}% of PNG.`,
    document.createElement("br"),
    `MRU encoded difference compressed size: ${mruDifferenceCompressedSize.toLocaleString()}, ${(
      (mruDifferenceCompressedSize / uncompressedFileSize) *
      100
    ).toFixed(3)}% of uncompressed, ${(
      (mruDifferenceCompressedSize / initialFileSize) *
      100
    ).toFixed(3)}% of PNG.`,
    document.createElement("br"),
    `MRU encoded double difference compressed size: ${mruDoubleDifferenceCompressedSize.toLocaleString()}, ${(
      (mruDoubleDifferenceCompressedSize / uncompressedFileSize) *
      100
    ).toFixed(3)}% of uncompressed, ${(
      (mruDoubleDifferenceCompressedSize / initialFileSize) *
      100
    ).toFixed(3)}% of PNG.`
  );
}

loadFromUrl("./reference-images/Lenna.png");
//loadFromUrl("./reference-images/Laser Light Show.png");
//loadFromUrl("./reference-images/Super Bright Lights.png");
//loadFromUrl("./reference-images/IMGP5493_seamless_2.png");
//loadFromUrl("https://qoiformat.org/benchmark/images/textures_photo/IMGP5493_seamless_2.png");

(window as any).philDebug = { loadFromUrl, EntropyEncoder, MruList };
