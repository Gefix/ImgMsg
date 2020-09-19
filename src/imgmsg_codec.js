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

/*
    ImgMsg Codec, v1.3

    Currently available code types:

    +------+-----+-------------+-----------------+--------------+----------+
    | Type | ECC | BitPattern  | Simulated Noise | Bits/Channel | Space *1 |
    +------+-----+-------------+-----------------+--------------+----------+
    | 02   | no  | uniform     | Quantization    | 4            | 50.0%    |
    +------+-----+-------------+-----------------+--------------+----------+
    | 03   | no  | half-normal | Gaussian *2     | 4            | 25.0%    |
    +------+-----+-------------+-----------------+--------------+----------+
    | 12*  | G24 | uniform     | Quantization    | 4            | 25.0%    |
    +------+-----+-------------+-----------------+--------------+----------+
    | 13   | G24 | half-normal | Gaussian *2     | 4            | 12.5%    |
    +------+-----+-------------+-----------------+--------------+----------+

    Default code: 12

    *1 Percentage of RGB bytes from all the fully opaque pixels
       If there are no (semi-)transparent pixels, then % of Width * Height * 3 bytes
       Note that this is after the LZW compression, so it may not correlate to the input
       data length exactly. Also there is always a 33-byte header regardless of the type

    *2 Each password generates a unique half-normal distribution amongst the lower half
       of the bits. If very long messages are encoded with different passwords many times
       in the same image, probably only the last will be readable, but all the other
       encodings would have contributed with random bit changes in the bits from their
       random sequences. If many such sequences are combined the resulting noise will yet
       again be characterized by a Quantization noise pattern.
       If a single message of maximum length is encoded in a fresh image, there will be
       no noticeable change in the image histogram, and the noise will appear to be with
       a normal distribution.
*/

var ImgMsgCodec = function (encodeProgressUpdate, decodeProgressUpdate) {
    const ECC_TYPE_NO = '0';
    const ECC_TYPE_G24 = '1';

    encodeProgressUpdate = encodeProgressUpdate || (() => { });
    decodeProgressUpdate = decodeProgressUpdate || (() => { });

    const golay = Golay();

    const scatterBitGenerator = ImgMsgScatter(golay.EncodedSize(16) * 8);

    const salt = new Uint8Array(16);
    for (let i = 0; i < salt.length; i++) {
        salt[i] = ((4 - 2 * (i & 1)) << (i >> 2)) ^ 42;
    }

    const lengthsuffix = '.l'.repeat(42);

    function toUint8Array(data) {
        if (data instanceof Uint8Array) return data;
        if (typeof data !== 'string') data = data.toString();
        return new TextEncoder('utf-8').encode(data);
    }

    function toUtf8String(data) {
        if (!(data instanceof Uint8Array)) return data;
        return new TextDecoder('utf-8').decode(data);
    }

    async function hashcrypt(pws) {
        let hash = pws;
        for (let i = 0; i < 256; i++) {
            const second_hash_length = hash.length + pws.length + 1;
            const second_hash = new Uint8Array(second_hash_length);
            second_hash.set(hash);
            second_hash.set(pws, hash.length);
            second_hash[second_hash_length - 1] = i;
            hash = new Uint8Array(await crypto.subtle.digest({ name: 'SHA-256' }, second_hash));
        }
        return hash;
    }

    async function preprocess(pw) {
        const pwa = toUint8Array(pw);
        const pws = new Uint8Array(salt.length + pwa.length);
        pws.set(salt);
        pws.set(pwa, salt.length);

        let hash = await hashcrypt(pws);

        let iv = await crypto.subtle.digest({ name: "SHA-256" }, hash);
        iv = iv.slice(10, 26);

        return [hash, iv];
    }

    async function encrypt(msg, pw) {
        const [rawKey, iv] = await preprocess(pw);
        const data = toUint8Array(msg);

        const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-CBC", length: 256 }, false, ["encrypt", "decrypt"]);
        const encrypted = await crypto.subtle.encrypt({ name: "AES-CBC", iv: iv }, key, data);
        const result = new Uint8Array(encrypted);

        return [result, iv];
    }

    async function decrypt(msg, rawKey, iv) {
        const data = toUint8Array(msg);

        const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-CBC", length: 256 }, false, ["encrypt", "decrypt"]);
        const decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv }, key, data);
        const result = new Uint8Array(decrypted);

        return result;
    }

    function encodeHeader(length, type) {
        if (type == "12") return toUint8Array(length);
        if (type.length != 2) throw "Incorrect type";

        const header = new Uint8Array(8);
        header.set(toUint8Array(`*${type}*`).slice(0, 4));
        header.set(new Uint8Array((new Uint32Array([length])).buffer), 4);
        return header;
    }

    function decodeHeader(header) {
        const utf8 = toUtf8String(header);
        let length = 0;
        let type = "12";

        if (/^[0-9]+$/.test(utf8)) {
            length = parseInt(utf8);
        } else if (header[0] == 42 && header[3] == 42) {
            length = new Uint32Array(header.buffer)[1];
            type = toUtf8String(header.subarray(1, 3));
        }

        return [length, type];
    }

    const ImgMsgCodec = {
        encode: async function (img, msg, pwd, type = "13") {
            await encodeProgressUpdate(0.1);

            const width = img.width;
            const height = img.height;
            const data = img.data;

            const eccType = type[0];
            const scatterType = type[1];

            msg = LZString.compressToUint8Array(msg);

            await encodeProgressUpdate(0.28);

            const [r] = await encrypt(msg, pwd);

            const header = encodeHeader(r.length, type);
            const [h, i] = await encrypt(header, pwd + lengthsuffix);

            const h2 = golay.EncodeUint8Array(h);

            let r2 = r;

            if (eccType == ECC_TYPE_G24) {
                r2 = golay.EncodeUint8Array(r2);
            }

            const encmsg = new Uint8Array(r2.length + h2.length);

            encmsg.set(h2, 0);
            encmsg.set(r2, h2.length);

            const encmsglen = encmsg.length;

            const seed = new Uint32Array(i);

            await encodeProgressUpdate(0.46);

            const generator = scatterBitGenerator(data, width, height, seed);

            const max_size = generator.freeSpace(scatterType) >> 3;

            if (encmsglen > max_size) {
                throw {
                    code: 1,
                    data: {
                        encodedSize: encmsglen,
                        availableSize: max_size
                    }
                }
            }

            await encodeProgressUpdate(0.64);

            const bits = generator.generate(encmsglen * 8, scatterType);

            for (let k = 0; k < encmsglen; k++) {
                let cd = encmsg[k];

                for (let j = 0; j < 8; j++) {
                    const i = k * 8 + j;
                    let r = bits[i];

                    let y = height - 1 - (r % height);
                    r = (r / height) | 0;
                    let x = width - 1 - (r % width);
                    r = (r / width) | 0;
                    const c = r % 3;
                    r = (r / 3) | 0;
                    const b = r % 7;
                    r = (r / 7) | 0;

                    const xor = 1 << (b);

                    const o = (y * img.width + x) * 4 + c;

                    if (cd % 2 == 1) {
                        data[o] |= xor;
                    } else {
                        data[o] &= ~xor;
                    }

                    cd >>= 1;
                }
            }
        },

        decode: async function (img, pwd) {
            await decodeProgressUpdate(0.10);

            const width = img.width;
            const height = img.height;
            const data = img.data;

            const [hash, iv] = await preprocess(pwd);
            const [hash_l, iv_l] = await preprocess(pwd + lengthsuffix);
            const seed = new Uint32Array(iv_l);

            await decodeProgressUpdate(0.28);

            const generator = scatterBitGenerator(data, width, height, seed);

            const read = (n, type) => {
                const result = new Uint8Array(n);
                const bits = generator.generate(n * 8, type);

                for (let k = 0; k < n; k++) {
                    let cd = 0;

                    for (let j = 0; j < 8; j++) {
                        const i = k * 8 + j;
                        let r = bits[i];

                        let y = height - 1 - (r % height);
                        r = (r / height) | 0;
                        let x = width - 1 - (r % width);
                        r = (r / width) | 0;
                        const c = r % 3;
                        r = (r / 3) | 0;
                        const b = r % 7;
                        r = (r / 7) | 0;

                        const xor = 1 << (b);

                        const o = (y * width + x) * 4 + c;

                        if ((data[o] & xor) == xor) {
                            cd |= 1 << j;
                        }
                    }

                    result[k] = cd;
                }

                return result;
            }

            const encheadersize = golay.EncodedSize(16);
            const encmsgenclen = golay.DecodeUint8Array(read(encheadersize), 16);

            const lengthtext = await decrypt(encmsgenclen, hash_l, iv_l);

            const [encmsglen, type] = decodeHeader(lengthtext);

            const eccType = type[0];
            const scatterType = type[1];

            const max_size = generator.freeSpace(scatterType) >> 3;

            let storedencmsglen = encmsglen;

            if (eccType == ECC_TYPE_G24) {
                storedencmsglen = golay.EncodedSize(encmsglen);
            }

            await decodeProgressUpdate(0.46);

            if (storedencmsglen < 2 || storedencmsglen > max_size) {
                throw "Could not decode";
            }

            let encmsg = read(storedencmsglen, scatterType);

            if (eccType == ECC_TYPE_G24) {
                encmsg = golay.DecodeUint8Array(encmsg, encmsglen);
            } else {
            }

            let msg = await decrypt(encmsg, hash, iv);

            await decodeProgressUpdate(0.64);

            msg = LZString.decompressFromUint8Array(msg);

            await decodeProgressUpdate(0.82);

            if (msg === null) {
                throw "Could not decode";
            }

            return msg;
        }
    }

    return ImgMsgCodec;
}
