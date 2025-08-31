export class EntropyEncoder {
  static costInBits(p: number) {
    return -Math.log2(p);
  }
  static bitsToBytes(bits: number) {
    const bytes = bits / 8;
    const blocks = Math.ceil(bytes / 4);
    return blocks * 4 + 8;
  }
  static costFromMap<T>(map: ReadonlyMap<T, number>) {
    let totalCount = 0;
    map.forEach((count: number) => (totalCount += count));
    let bitCount = 0;
    map.forEach((count: number) => {
      if (count != 0) {
        const p = count / totalCount;
        const perItem = EntropyEncoder.costInBits(p);
        bitCount += count * perItem;
      }
    });
    return this.bitsToBytes(bitCount);
  }
}
