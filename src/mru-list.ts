import { initializedArray } from "phil-lib/misc";

/**
 * This takes a stream of symbols that were appropriate for use in an entropy encoder,
 * and it produces a stream of symbols that might do even better in the entropy encoder.
 * The assumption is that some symbols are much more common than others, so an entropy encoder is appropriate.
 * The new assumption is that the most common symbols might change over time.
 * We keep track of the most recently used (MRU) symbols.
 * If you want to repeat the symbol you just sent, that will always be encoded as a 0.
 * Any time any item is used it is immediately promoted to index 0.
 * Other items move back one place in line as needed to make room.
 */
export class MruList {
  #items: number[];
  constructor(allLegalValues: number[]) {
    this.#items = [...allLegalValues];
  }
  static bytes() {
    return new this(initializedArray(256, (n) => n));
  }
  static diffs() {
    const items = [0];
    for (let i = 1; i < 256; i++) {
      items.push(i, -i);
    }
    return new this(items);
  }
  encode(value: number) {
    const index = this.#items.indexOf(value);
    if (index < 0) {
      throw new Error("wtf");
    }
    this.#items.splice(index, 1);
    this.#items.unshift(value);
    return index;
  }
  decode(index: number) {
    const [value] = this.#items.splice(index, 1);
    this.#items.unshift(value);
    return value;
  }
}
