// Copyright (c) 2020 Dimitar Blagoev (Gef[r]ix)
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

var ImgMsgScatter = function (headerSize) {
    const HEADER_SIZE = headerSize;
    const PROBABILITY_TYPE_G = [0.8, 0.665272, 0.382584, 0.152144];

    const SCATTER_TYPE_U = '2';
    const SCATTER_TYPE_G = '3';
    const DEFAULT_SCATTER_TYPE = SCATTER_TYPE_U;

    function sfc32(a, b, c, d) {
        return function () {
            a |= 0; b |= 0; c |= 0;
            d = d + 1 | 0;
            const t = (a + b | 0) + d | 0;
            a = b ^ b >>> 9;
            b = c + (c << 3) | 0;
            c = (c << 21 | c >>> 11);
            c = c + t | 0;
            return (t >>> 0) / 4294967296;
        }
    }

    function gatherAvailableBits(data, width, height) {
        const pixels_count = width * height;
        let pixels = new Uint32Array(pixels_count);

        let skipped = 0;
        for (let i = 0; i < pixels_count; i++) {
            let r = i;
            const y = height - 1 - (r % height); r = (r / height) | 0;
            const x = width - 1 - (r % width);
            const o = (y * width + x) * 4 + 3;

            if (data[o] === 255) {
                pixels[i - skipped] = i;
            } else {
                skipped++;
            }
        }

        const available_pixels = pixels_count - skipped;
        const gather = new Uint32Array(available_pixels * 3 * 4);

        for (let bit = 0, offset = 0; bit < 4; bit++) {
            for (let channel = 0; channel < 3; channel++) {
                const o2 = pixels_count * (bit * 3 + channel);

                for (let i = 0; i < available_pixels; i++) {
                    gather[offset++] = pixels[i] + o2;
                }
            }
        }

        return gather;
    }

    function bitShufflerTypeU(rng, gather) {
        const total = gather.length;

        let used = 0;
        let last_pos = 0;

        function shuffle(bits, n) {
            for (let j = 0; j < n; j++) {
                const i = used + j;

                let r = (Math.round(rng() * (total - i - 1)) + last_pos) % (total - i);
                last_pos = r;

                let g = gather[r];
                gather[r] = gather[total - i - 1];

                bits[j] = g;
            }
            used += n;
        }

        return {
            used: () => used,
            pos: () => last_pos,
            shuffle: shuffle
        }
    }

    function bitShufflerTypeGfromTypeU(rng, gather, shuffler, width, height) {
        let total_used = shuffler.used();
        let last_pos = shuffler.pos();

        const used_per_layer = total_used >> 2;
        const bits_per_layer = gather.length >> 2;

        const buckets = [];

        const left_bits_per_layer = bits_per_layer - used_per_layer;

        // If the available number of pixels is less than 128 x 128 we will sort the remaining lot.
        // :
        // Due to the way Fisher-Yates works, for each shuffled (taken) bit,
        // one bit from the end is put in its place.
        // For the TypeU header, this is always a layer-4 bit (bit sequence is L1,L2,L3,L4).
        // If the available pixels are low the 264 bits used already by the TypeU shuffler for
        // the header may result in a significant amount of layer-4 bits present in all other layers.
        // In the extreme case of < 16 x 16 this results in more layer-4 bits being used than layer-3.

        if (bits_per_layer < (1 << 14) * 3) {
            const layer_size = width * height * 3;
            const window_size = left_bits_per_layer * 4;

            const radix_counts = new Uint32Array(4);
            const radix = gather.slice();

            for (let i = 0; i < window_size; i++) {
                radix_counts[gather[i] / layer_size | 0]++;
            }

            for (let i = 3; i > 0; i--) {
                radix_counts[i - 1] += radix_counts[i];
            }

            for (let i = 0; i < window_size; i++) {
                radix[window_size - (radix_counts[gather[i] / layer_size | 0]--)] = gather[i];
            }

            gather = radix;
        }

        for (let i = 0; i < 4; i++) {
            buckets[i] = gather.subarray(left_bits_per_layer * i, left_bits_per_layer * (i + 1));
        }

        const bucket_size = buckets[0].length;
        const bucket_used = new Uint32Array(4);

        const bucket_quota = new Uint32Array(4);
        let total_quota = 0;
        for (let i = 3; i > 0; i--) {
            bucket_quota[i] = Math.max(0, bits_per_layer * PROBABILITY_TYPE_G[i] - used_per_layer);
            total_quota += bucket_quota[i];
        }
        bucket_quota[0] = (gather.length >> 1) - total_quota - total_used;
        total_quota += bucket_quota[0];

        const bucket_rng_buffer_size = 1 << 12;
        const bucket_rng_buffer = new Float64Array(bucket_rng_buffer_size);
        let bucket_rng_buffer_pos = bucket_rng_buffer_size - 1;

        function shuffle(bits, n) {
            for (let j = 0; j < n; j++) {
                if (bucket_rng_buffer_pos == bucket_rng_buffer_size - 1) {
                    for (let i = 0; i < bucket_rng_buffer_size; i++) {
                        bucket_rng_buffer[i] = rng();
                    }
                    bucket_rng_buffer_pos = 0;
                }

                const rb = bucket_rng_buffer[bucket_rng_buffer_pos++] * total_quota | 0;
                const b = (rb >= bucket_quota[0] | 0) + (rb >= bucket_quota[0] + bucket_quota[1] | 0) + (rb >= bucket_quota[0] + bucket_quota[1] + bucket_quota[2] | 0);

                const bucket = buckets[b];

                const bu = bucket_used[b];
                let r = (Math.round(rng() * (bucket_size - bu - 1)) + last_pos) % (bucket_size - bu);

                bits[j] = bucket[r];

                last_pos = r;
                bucket[r] = bucket[bucket_size - bu - 1];
                bucket_used[b]++;
                bucket_quota[b]--;
                total_quota--;
            }
            total_used += n;
        }

        return {
            used: () => total_used,
            pos: () => last_pos,
            shuffle: shuffle
        }
    }

    function scatterBitGenerator(data, width, height, seed) {
        const rng = sfc32(seed[0], seed[1], seed[2], 1);

        for (let i = (1 << 16) + (seed[3] >> 16) + (seed[3] & 0xffff); i >= 0; i--) {
            rng();
        }

        const gather = gatherAvailableBits(data, width, height);
        const max_size_U = gather.length;
        const max_size_G = max_size_U >> 1;

        let shuffler = bitShufflerTypeU(rng, gather);

        let prev_t = SCATTER_TYPE_U;

        function freeSpace(scatterType = DEFAULT_SCATTER_TYPE) {
            switch (scatterType) {
                case SCATTER_TYPE_U: return max_size_U - shuffler.used();
                case SCATTER_TYPE_G: return max_size_G - shuffler.used();
            }
        }

        function generate(n, scatterType = DEFAULT_SCATTER_TYPE) {
            if (n > freeSpace(scatterType)) throw "Not enough space";

            const bits = new Uint32Array(n);
            let offset = 0;

            if (shuffler.used() < HEADER_SIZE) {
                const count = Math.min(HEADER_SIZE - shuffler.used(), n);
                shuffler.shuffle(bits, count);
                n -= count;
                offset += count;
            }

            if (n == 0) return bits;

            const t1 = Date.now();

            if (scatterType != prev_t) {
                if (prev_t == SCATTER_TYPE_U && scatterType == SCATTER_TYPE_G) {
                    shuffler = bitShufflerTypeGfromTypeU(rng, gather, shuffler, width, height);
                } else {
                    throw "Cannot switch to new type from current"
                }
            }

            shuffler.shuffle(bits.subarray(offset), n);

            return bits;
        }

        return {
            freeSpace: freeSpace,
            generate: generate
        }
    }

    return scatterBitGenerator;
}
