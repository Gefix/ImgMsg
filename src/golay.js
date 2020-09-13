function Golay() {

    const GOLAY_SIZE = 0x1000;

    const G_P = new Uint16Array([
        0xc75, 0x63b, 0xf68, 0x7b4,
        0x3da, 0xd99, 0x6cd, 0x367,
        0xdc6, 0xa97, 0x93e, 0x8eb
    ]);

    const H_P = new Uint16Array([
        0xa4f, 0xf68, 0x7b4, 0x3da,
        0x1ed, 0xab9, 0xf13, 0xdc6,
        0x6e3, 0x93e, 0x49f, 0xc75
    ]);

    const EncodeTable = new Uint32Array(GOLAY_SIZE);
    const SyndromeTable = new Uint16Array(GOLAY_SIZE);
    const CorrectTable = new Uint16Array(GOLAY_SIZE);

    function Syndrome(v) {
        return SyndromeTable[v & 0xfff] ^ ((v >> 12) & 0xfff);
    }

    function Encode(v) {
        return EncodeTable[v & 0xfff];
    }

    function Decode(v) {
        return (((v >> 12) & 0xfff) ^ CorrectTable[Syndrome(v)]);
    }

    function InitGolay() {
        for (let x = 0; x < GOLAY_SIZE; x++) {
            EncodeTable[x] = (x << 12);
            for (let i = 0; i < 12; i++) {
                if ((x >> (11 - i)) & 1)
                    EncodeTable[x] ^= G_P[i];
            }
        }

        for (let x = 0; x < GOLAY_SIZE; x++) {
            SyndromeTable[x] = 0;
            for (let i = 0; i < 12; i++) {
                if ((x >> (11 - i)) & 1) SyndromeTable[x] ^= H_P[i];
            }
        }

        CorrectTable[0] = 0;

        for (let i = 0; i < 24; i++) {
            for (let j = i; j < 24; j++) {
                for (let k = j; k < 24; k++) {
                    for (let l = k; l < 24; l++) {
                        const error = (1 << i) | (1 << j) | (1 << k) | (1 << l);
                        const syndrome = Syndrome(error);
                        CorrectTable[syndrome] = (error >> 12) & 0xfff;
                    }
                }
            }
        }
    }

    InitGolay();

    function EncodedSize(size) {
        return Math.floor(((size + 1) * 8) / 12) * 3;
    }

    function EncodeUint8Array(data) {
        const wordsCount = Math.floor(((data.length + 1) * 8) / 12);
        const encoded = new Uint8Array(wordsCount * 3);
        for (let i = 0; i < wordsCount; i++) {
            const o = i + (i >> 1);
            const bo = (i & 1) << 2;
            const word = (data[o] << 4 + bo) + (data[o + 1] >> 4 - bo);
            const wordEncoded = Encode(word);
            const o2 = i + (i << 1);
            encoded[o2] = wordEncoded >> 16;
            encoded[o2 + 1] = wordEncoded >> 8;
            encoded[o2 + 2] = wordEncoded;
        }
        return encoded;
    }

    function DecodeUint8Array(encoded, size) {
        const wordsCount = Math.floor(encoded.length / 3);
        const data = new Uint8Array(size);
        for (let i = 0; i < wordsCount; i++) {
            const o2 = i + (i << 1);
            const wordEncoded = (encoded[o2] << 16) + (encoded[o2 + 1] << 8) + (encoded[o2 + 2] | 0);
            const word = Decode(wordEncoded);
            const o = i + (i >> 1);
            const bo = (i & 1) << 2;
            data[o] |= word >> 4 + bo;
            data[o + 1] = word << 4 - bo;
        }
        return data;
    }

    return {
        EncodedSize: EncodedSize,
        EncodeUint8Array: EncodeUint8Array,
        DecodeUint8Array: DecodeUint8Array
    }
}
